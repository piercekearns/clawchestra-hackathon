import matter from 'gray-matter';
import type { DashboardSettings } from './settings';
import {
  type BranchInjectionResult,
  createProjectWithState,
  createDirectory,
  gitInitRepo,
  injectAgentGuidance,
  pathExists,
  pickFolder,
  probeRepo,
  readFile,
  renameProjectMd,
  removePath,
  runMigration,
  writeFile,
} from './tauri';
import type { ProjectStatus, ProjectViewModel } from './schema';

const RESERVED_IDS = new Set(['index', 'projects', 'templates', 'con', 'prn', 'aux', 'nul']);
const MUTATION_LOCK_ERROR_PREFIX = 'mutationLocked:';
const MAX_MUTATION_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 75;

function isMutationLockedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MUTATION_LOCK_ERROR_PREFIX);
}

async function withMutationRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (attempt < MAX_MUTATION_RETRIES) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (!isMutationLockedError(error) || attempt >= MAX_MUTATION_RETRIES) {
        throw error;
      }
      const backoff = RETRY_BASE_DELAY_MS * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw new Error('Mutation retry loop exited unexpectedly');
}

export function canonicalSlugify(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const fallback = normalized || 'project';
  const trimmed = fallback.slice(0, 63).replace(/-+$/g, '');
  return trimmed || 'project';
}

export function isReservedProjectId(value: string): boolean {
  return RESERVED_IDS.has(value);
}

export function titleFromFolderName(folderName: string): string {
  return folderName
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizePathForComparison(path: string): string {
  return path.replace(/\/+$/g, '');
}

function compactFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined),
  );
}

function ensureInsideScanPaths(path: string, scanPaths: string[]): { inside: boolean; root?: string } {
  const normalized = normalizePathForComparison(path);
  for (const root of scanPaths) {
    const rootNormalized = normalizePathForComparison(root);
    if (!rootNormalized) continue;
    if (normalized === rootNormalized || normalized.startsWith(`${rootNormalized}/`)) {
      return { inside: true, root };
    }
  }
  return { inside: false };
}

function summarizeInjectionOutcomes(results: BranchInjectionResult[]): string | null {
  const skipped = results.filter((entry) => !entry.success);
  if (skipped.length === 0) return null;
  const details = skipped
    .map((entry) => `${entry.name}${entry.skipReason ? ` (${entry.skipReason})` : ''}`)
    .join(', ');
  return `Guidance injection skipped on ${skipped.length} branch(es): ${details}`;
}

export type CompatibilityAction = {
  type: 'create' | 'update' | 'prompt';
  file: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
};

export type ProjectMdStatus = 'valid' | 'missing-frontmatter' | 'invalid-frontmatter';

export type CompatibilityReport = {
  folderPath: string;
  folderName: string;
  isGitRepo: boolean;
  gitBranch?: string;
  gitRemote?: string;
  hasClawchestraMd: boolean;
  hasLegacyProjectMd: boolean;
  hasProjectMd: boolean;
  projectMdStatus?: ProjectMdStatus;
  hasRoadmapMd: boolean;
  hasStateJson: boolean;
  hasAgentsMd: boolean;
  hasReadme: boolean;
  inferredTitle: string;
  inferredId: string;
  inferredStatus: ProjectStatus;
  detectedStatus?: ProjectStatus;
  inferredRepo?: string;
  idConflict: boolean;
  conflictingEntryId?: string;
  insideScanPaths: boolean;
  matchedScanPath?: string;
  isWorkingTreeDirty?: boolean;
  dirtyPaths?: string[];
  actions: CompatibilityAction[];
};

export async function checkExistingProjectCompatibility(args: {
  folderPath: string;
  scanPaths: string[];
  existingProjects: ProjectViewModel[];
}): Promise<CompatibilityReport> {
  const folderName = args.folderPath.split('/').pop() || args.folderPath;
  const repoInfo = await probeRepo(args.folderPath);

  // 5.19: Check CLAWCHESTRA.md first, fall back to PROJECT.md
  const clawchestraPath = `${args.folderPath}/CLAWCHESTRA.md`;
  const legacyProjectPath = `${args.folderPath}/PROJECT.md`;
  const roadmapPath = `${args.folderPath}/ROADMAP.md`;
  const stateJsonPath = `${args.folderPath}/.clawchestra/state.json`;
  const agentsPath = `${args.folderPath}/AGENTS.md`;
  const readmePath = `${args.folderPath}/README.md`;

  const hasClawchestraMd = await pathExists(clawchestraPath);
  const hasLegacyProjectMd = await pathExists(legacyProjectPath);
  const hasProjectMd = hasClawchestraMd || hasLegacyProjectMd;
  const projectPath = hasClawchestraMd ? clawchestraPath : legacyProjectPath;
  const hasRoadmapMd = await pathExists(roadmapPath);
  const hasStateJson = await pathExists(stateJsonPath);
  const hasAgentsMd = await pathExists(agentsPath);
  const hasReadme = await pathExists(readmePath);

  let projectMdStatus: ProjectMdStatus | undefined;
  let detectedStatus: ProjectStatus | undefined;
  let inferredTitle = titleFromFolderName(folderName);

  if (hasProjectMd) {
    const raw = await readFile(projectPath);
    const hasFrontmatter = raw.trimStart().startsWith('---');
    if (!hasFrontmatter) {
      projectMdStatus = 'missing-frontmatter';
    } else {
      const { data } = matter(raw);
      const record = data as Record<string, unknown>;
      if (typeof record.title === 'string') inferredTitle = record.title;
      if (typeof record.status === 'string') detectedStatus = record.status as ProjectStatus;
      projectMdStatus = record.title ? 'valid' : 'invalid-frontmatter';
    }
  }

  const inferredStatus: ProjectStatus = detectedStatus ?? 'pending';
  const inferredId = canonicalSlugify(inferredTitle || folderName);

  const matchingProject = args.existingProjects.find((entry) => entry.id === inferredId);
  const idConflict = matchingProject
    ? normalizePathForComparison(matchingProject.dirPath) !== normalizePathForComparison(args.folderPath)
    : false;
  const conflictingEntryId = idConflict ? inferredId : undefined;

  const scanPathCheck = ensureInsideScanPaths(args.folderPath, args.scanPaths);
  const actions: CompatibilityAction[] = [];

  // 5.19: Dual-filename warning
  if (hasClawchestraMd && hasLegacyProjectMd) {
    actions.push({
      type: 'prompt',
      file: 'PROJECT.md',
      description: 'Both CLAWCHESTRA.md and PROJECT.md found. CLAWCHESTRA.md takes precedence. Delete PROJECT.md to resolve.',
      severity: 'warning',
    });
  }

  if (!hasProjectMd) {
    actions.push({
      type: 'create',
      file: 'CLAWCHESTRA.md',
      description: 'Create CLAWCHESTRA.md from template',
      severity: 'warning',
    });
  } else if (projectMdStatus === 'missing-frontmatter' && !hasClawchestraMd) {
    // Only warn about frontmatter on legacy PROJECT.md (CLAWCHESTRA.md has no frontmatter)
    actions.push({
      type: 'update',
      file: 'PROJECT.md',
      description: 'Add frontmatter block to PROJECT.md',
      severity: 'warning',
    });
  } else if (projectMdStatus === 'invalid-frontmatter' && !hasClawchestraMd) {
    actions.push({
      type: 'prompt',
      file: 'PROJECT.md',
      description: 'Fix invalid PROJECT.md frontmatter manually before adding',
      severity: 'error',
    });
  }
  if (!hasAgentsMd) {
    actions.push({
      type: 'create',
      file: 'AGENTS.md',
      description: 'Create AGENTS.md template',
      severity: 'info',
    });
  }
  if (!repoInfo.isGitRepo) {
    actions.push({
      type: 'prompt',
      file: '.git',
      description: 'Optionally initialize git repository',
      severity: 'info',
    });
  }
  if (idConflict) {
    actions.push({
      type: 'prompt',
      file: 'project',
      description: `Project id conflict for "${inferredId}"`,
      severity: 'error',
    });
  }
  if (!scanPathCheck.inside) {
    actions.push({
      type: 'prompt',
      file: 'settings',
      description: 'Folder is outside scan paths; add to settings first',
      severity: 'warning',
    });
  }
  if (hasStateJson) {
    actions.push({
      type: 'prompt',
      file: '.clawchestra/state.json',
      description: 'Existing state.json detected; onboarding will preserve and import it.',
      severity: 'info',
    });
  }
  if (hasRoadmapMd) {
    actions.push({
      type: 'prompt',
      file: 'ROADMAP.md',
      description: 'Legacy roadmap detected; onboarding will run migration before registration.',
      severity: 'info',
    });
  }

  return {
    folderPath: args.folderPath,
    folderName,
    isGitRepo: repoInfo.isGitRepo,
    gitBranch: repoInfo.gitBranch,
    gitRemote: repoInfo.gitRemote,
    hasClawchestraMd,
    hasLegacyProjectMd,
    hasProjectMd,
    projectMdStatus,
    hasRoadmapMd,
    hasStateJson,
    hasAgentsMd,
    hasReadme,
    inferredTitle,
    inferredId,
    inferredStatus,
    detectedStatus,
    inferredRepo: repoInfo.gitRemote,
    idConflict,
    conflictingEntryId,
    insideScanPaths: scanPathCheck.inside,
    matchedScanPath: scanPathCheck.root,
    isWorkingTreeDirty: repoInfo.isWorkingTreeDirty,
    dirtyPaths: repoInfo.dirtyPaths,
    actions,
  };
}

type CreateFlowInput = {
  title: string;
  folderName: string;
  scanPath: string;
  scanPaths: string[];
  status: ProjectStatus;
  priority?: number;
  initializeGit: boolean;
  createAgents: boolean;
};

function projectBodyTemplate(title: string): string {
  return `# ${title}

## Overview

Describe the purpose, scope, and current state of this project.
`;
}

function agentsTemplate(title: string): string {
  return `# AGENTS.md — ${title}

Instructions for agents working on this project.
`;
}

export async function createNewProjectFlow(
  input: CreateFlowInput,
  existingProjects: ProjectViewModel[],
): Promise<{ id: string; localPath: string; notes: string[] }> {
  const title = input.title.trim();
  if (!title) throw new Error('Project title is required');

  const id = canonicalSlugify(input.folderName);
  if (isReservedProjectId(id)) {
    throw new Error(`"${id}" is reserved. Choose a different folder name.`);
  }
  const localPath = `${input.scanPath}/${id}`;

  const existingMatch = existingProjects.find((project) => project.id === id);
  if (existingMatch) {
    if (
      normalizePathForComparison(existingMatch.dirPath)
      === normalizePathForComparison(localPath)
    ) {
      return { id, localPath, notes: [] };
    }
    throw new Error(`A project with id "${id}" already exists`);
  }

  if (input.scanPaths.length > 0) {
    const policy = ensureInsideScanPaths(input.scanPath, input.scanPaths);
    if (!policy.inside) {
      throw new Error('Selected path is outside configured scan paths');
    }
  }

  if (await pathExists(localPath)) {
    const hasCanonicalMd = await pathExists(`${localPath}/CLAWCHESTRA.md`);
    const hasStateJson = await pathExists(`${localPath}/.clawchestra/state.json`);
    if (hasCanonicalMd && hasStateJson) {
      await createProjectWithState(id, localPath, title, input.status, '');
      return { id, localPath, notes: [] };
    }
    throw new Error(`Target folder already exists: ${localPath}`);
  }

  const createdFiles: string[] = [];
  let folderCreated = false;
  const notes: string[] = [];

  try {
    await withMutationRetry(() => createDirectory(localPath));
    folderCreated = true;

    const projectMarkdown = matter.stringify(
      projectBodyTemplate(title),
      compactFrontmatter({
        title,
        status: input.status,
        type: 'project',
        priority: input.priority,
        lastActivity: new Date().toISOString().split('T')[0],
        nextAction: 'Define first implementation milestone',
      }),
    );
    await withMutationRetry(() => writeFile(`${localPath}/CLAWCHESTRA.md`, projectMarkdown));
    createdFiles.push('CLAWCHESTRA.md');

    if (input.createAgents) {
      await withMutationRetry(() => writeFile(`${localPath}/AGENTS.md`, agentsTemplate(title)));
      createdFiles.push('AGENTS.md');
    }

    await withMutationRetry(() =>
      writeFile(
        `${localPath}/.gitignore`,
        `node_modules\n.DS_Store\ndist\n.target\n.clawchestra/\n`,
      ),
    );
    createdFiles.push('.gitignore');

    if (input.initializeGit) {
      await gitInitRepo(localPath, true, createdFiles);
    }

    await createProjectWithState(id, localPath, title, input.status, '');

    if (input.initializeGit) {
      const injectionResults = await injectAgentGuidance(localPath).catch(() => null);
      if (injectionResults === null) {
        notes.push('Guidance injection failed after git initialization.');
      } else {
        const summary = summarizeInjectionOutcomes(injectionResults);
        if (summary) notes.push(summary);
      }
    }

    return { id, localPath, notes };
  } catch (error) {
    for (const relative of createdFiles) {
      await withMutationRetry(() => removePath(`${localPath}/${relative}`)).catch(() => undefined);
    }
    if (folderCreated) {
      await withMutationRetry(() => removePath(localPath)).catch(() => undefined);
    }
    throw error;
  }
}

type AddExistingInput = {
  report: CompatibilityReport;
  id: string;
  title: string;
  fallbackStatus: ProjectStatus;
  addMissingProjectMd: boolean;
  addMissingFrontmatter: boolean;
  addMissingAgents: boolean;
  initGitIfMissing: boolean;
  allowDirtyOverride: boolean;
};

export async function addExistingProjectFlow(
  input: AddExistingInput,
  existingProjects: ProjectViewModel[],
): Promise<{ id: string; localPath: string; notes: string[] }> {
  if (input.report.projectMdStatus === 'invalid-frontmatter') {
    throw new Error('PROJECT.md frontmatter is invalid. Fix it before adding.');
  }
  if (input.report.isWorkingTreeDirty && !input.allowDirtyOverride) {
    throw new Error('Repo is dirty. Enable override to continue.');
  }
  if (!input.report.insideScanPaths) {
    throw new Error('Selected folder is outside scan paths. Update settings first.');
  }

  const id = canonicalSlugify(input.id);
  if (isReservedProjectId(id)) {
    throw new Error(`"${id}" is reserved. Choose a different id.`);
  }
  const existingMatch = existingProjects.find((project) => project.id === id);
  if (
    existingMatch
    && normalizePathForComparison(existingMatch.dirPath) !== normalizePathForComparison(input.report.folderPath)
  ) {
    throw new Error(`A project with id "${id}" already exists`);
  }

  const localPath = input.report.folderPath;
  const createdFilePaths: string[] = [];
  const backups = new Map<string, string>();
  const notes: string[] = [];

  const writeWithBackup = async (filePath: string, content: string): Promise<void> => {
    const exists = await pathExists(filePath);
    if (exists) {
      if (!backups.has(filePath)) {
        backups.set(filePath, await readFile(filePath));
      }
    } else {
      createdFilePaths.push(filePath);
    }
    await withMutationRetry(() => writeFile(filePath, content));
  };

  try {
    // 5.19: Use CLAWCHESTRA.md for new files, respect existing PROJECT.md for legacy
    const hasClawchestra = await pathExists(`${localPath}/CLAWCHESTRA.md`);
    const projectPath = hasClawchestra ? `${localPath}/CLAWCHESTRA.md` : `${localPath}/PROJECT.md`;
    const projectFileName = hasClawchestra ? 'CLAWCHESTRA.md' : 'PROJECT.md';

    if (!input.report.hasProjectMd && input.addMissingProjectMd) {
      // New creation: always use CLAWCHESTRA.md
      const newProjectPath = `${localPath}/CLAWCHESTRA.md`;
      const projectMarkdown = matter.stringify(
        projectBodyTemplate(input.title),
        compactFrontmatter({
          title: input.title,
          status: input.fallbackStatus,
          type: 'project',
          lastActivity: new Date().toISOString().split('T')[0],
        }),
      );
      await writeWithBackup(newProjectPath, projectMarkdown);
    } else if (
      input.report.projectMdStatus === 'missing-frontmatter'
      && !hasClawchestra
      && input.addMissingFrontmatter
    ) {
      const current = await readFile(projectPath);
      const patched = matter.stringify(
        current,
        compactFrontmatter({
          title: input.title,
          status: input.fallbackStatus,
          type: 'project',
        }),
      );
      await writeWithBackup(projectPath, patched);
    }

    if (!input.report.hasAgentsMd && input.addMissingAgents) {
      await writeWithBackup(`${localPath}/AGENTS.md`, agentsTemplate(input.title));
    }

    if (input.report.hasStateJson) {
      const stateJsonPath = `${localPath}/.clawchestra/state.json`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${localPath}/.clawchestra/backup/state.pre-onboarding.${timestamp}.json`;
      const stateContent = await readFile(stateJsonPath);
      await withMutationRetry(() => writeFile(backupPath, stateContent));
    }

    if (!input.report.isGitRepo && input.initGitIfMissing) {
      const filesForCommit = [
        input.report.hasProjectMd ? projectFileName : 'CLAWCHESTRA.md',
        ...(input.addMissingAgents ? ['AGENTS.md'] : []),
      ];
      await gitInitRepo(localPath, true, filesForCommit);
    }

    if (input.report.hasRoadmapMd) {
      const migration = await runMigration(id, localPath, input.title);
      if (migration.error) {
        throw new Error(`Migration failed: ${migration.error}`);
      }
      if (migration.stepAfter !== 'Complete') {
        throw new Error(`Migration incomplete: finished at ${migration.stepAfter}`);
      }
    }

    await createProjectWithState(id, localPath, input.title, input.fallbackStatus, '');
    const renamed = await renameProjectMd(localPath).catch(() => false);
    const canonicalMdExists = await pathExists(`${localPath}/CLAWCHESTRA.md`);
    if (!canonicalMdExists) {
      throw new Error('Onboarding incomplete: CLAWCHESTRA.md is missing after canonicalization.');
    }
    if (!renamed && input.report.hasLegacyProjectMd) {
      notes.push('PROJECT.md rename to CLAWCHESTRA.md was skipped or failed.');
    }

    const shouldInjectGuidance = input.report.isGitRepo || input.initGitIfMissing;
    if (shouldInjectGuidance) {
      const injectionResults = await injectAgentGuidance(localPath).catch(() => null);
      if (injectionResults === null) {
        notes.push('Guidance injection failed after onboarding.');
      } else {
        const summary = summarizeInjectionOutcomes(injectionResults);
        if (summary) notes.push(summary);
      }
    }

    return { id, localPath, notes };
  } catch (error) {
    for (const createdPath of createdFilePaths) {
      await withMutationRetry(() => removePath(createdPath)).catch(() => undefined);
    }
    for (const [filePath, content] of backups.entries()) {
      await withMutationRetry(() => writeFile(filePath, content)).catch(() => undefined);
    }
    throw error;
  }
}

export async function chooseFolder(initialPath?: string | null): Promise<string | null> {
  return pickFolder(initialPath);
}

export async function chooseScanPath(settings: DashboardSettings | null): Promise<string | null> {
  const preferred = settings?.scanPaths[0] ?? null;
  return pickFolder(preferred);
}

import matter from 'gray-matter';
import type { DashboardSettings } from './settings';
import { createProject, removeProject } from './projects';
import {
  createDirectory,
  getProjectsDir,
  gitInitRepo,
  pathExists,
  pickFolder,
  probeRepo,
  readFile,
  removePath,
  resolvePath,
  runArchitectureV2Migration,
  writeFile,
  type MigrationReport,
} from './tauri';
import type { ProjectStatus, ProjectViewModel, RepoStatus } from './schema';
import { validateRepoStatus } from './schema';

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

function ensureInsideWorkspace(path: string, workspaceRoots: string[]): { inside: boolean; root?: string } {
  const normalized = normalizePathForComparison(path);
  for (const root of workspaceRoots) {
    const rootNormalized = normalizePathForComparison(root);
    if (!rootNormalized) continue;
    if (normalized === rootNormalized || normalized.startsWith(`${rootNormalized}/`)) {
      return { inside: true, root };
    }
  }
  return { inside: false };
}

function extractProjectFrontmatterState(raw: string): {
  hasFrontmatter: boolean;
  repoStatus: RepoStatus | null;
} {
  const hasFrontmatter = raw.trimStart().startsWith('---');
  const parsed = matter(raw);
  return {
    hasFrontmatter,
    repoStatus: validateRepoStatus(parsed.data),
  };
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
  hasProjectMd: boolean;
  projectMdStatus?: ProjectMdStatus;
  hasRoadmapMd: boolean;
  hasAgentsMd: boolean;
  hasReadme: boolean;
  inferredTitle: string;
  inferredId: string;
  inferredStatus: ProjectStatus;
  detectedStatus?: ProjectStatus;
  inferredRepo?: string;
  catalogIdConflict: boolean;
  localPathConflict: boolean;
  conflictingEntryId?: string;
  insideWorkspaceRoots: boolean;
  matchedWorkspaceRoot?: string;
  requiresWorkspaceApproval: boolean;
  isWorkingTreeDirty?: boolean;
  dirtyPaths?: string[];
  actions: CompatibilityAction[];
};

async function resolveExistingLocalPath(path: string): Promise<string | null> {
  try {
    return await resolvePath(path);
  } catch {
    return null;
  }
}

export async function checkExistingProjectCompatibility(args: {
  folderPath: string;
  workspaceRoots: string[];
  existingProjects: ProjectViewModel[];
}): Promise<CompatibilityReport> {
  const resolvedFolderPath = await resolvePath(args.folderPath);
  const folderName = resolvedFolderPath.split('/').pop() || resolvedFolderPath;

  const repoInfo = await probeRepo(resolvedFolderPath);

  const projectPath = `${resolvedFolderPath}/PROJECT.md`;
  const roadmapPath = `${resolvedFolderPath}/ROADMAP.md`;
  const agentsPath = `${resolvedFolderPath}/AGENTS.md`;
  const readmePath = `${resolvedFolderPath}/README.md`;

  const hasProjectMd = await pathExists(projectPath);
  const hasRoadmapMd = await pathExists(roadmapPath);
  const hasAgentsMd = await pathExists(agentsPath);
  const hasReadme = await pathExists(readmePath);

  let projectMdStatus: ProjectMdStatus | undefined;
  let detectedStatus: ProjectStatus | undefined;
  let inferredTitle = titleFromFolderName(folderName);

  if (hasProjectMd) {
    const raw = await readFile(projectPath);
    const parsed = extractProjectFrontmatterState(raw);
    if (!parsed.hasFrontmatter) {
      projectMdStatus = 'missing-frontmatter';
    } else if (!parsed.repoStatus) {
      projectMdStatus = 'invalid-frontmatter';
    } else {
      projectMdStatus = 'valid';
      detectedStatus = parsed.repoStatus.status;
      if (parsed.repoStatus.title) {
        inferredTitle = parsed.repoStatus.title;
      }
    }
  }

  const inferredStatus: ProjectStatus = detectedStatus ?? 'simmering';
  const inferredId = canonicalSlugify(inferredTitle || folderName);

  let localPathConflict = false;
  let conflictingEntryId: string | undefined;
  for (const entry of args.existingProjects) {
    const localPath = entry.frontmatter.localPath;
    if (!localPath) continue;
    const resolved = await resolveExistingLocalPath(localPath);
    if (!resolved) continue;
    if (normalizePathForComparison(resolved) === normalizePathForComparison(resolvedFolderPath)) {
      localPathConflict = true;
      conflictingEntryId = entry.id;
      break;
    }
  }

  const catalogIdConflict = args.existingProjects.some((entry) => entry.id === inferredId);
  if (!conflictingEntryId && catalogIdConflict) {
    conflictingEntryId = inferredId;
  }

  const workspaceCheck = ensureInsideWorkspace(resolvedFolderPath, args.workspaceRoots);
  const actions: CompatibilityAction[] = [];

  if (!hasProjectMd) {
    actions.push({
      type: 'create',
      file: 'PROJECT.md',
      description: 'Create PROJECT.md from template',
      severity: 'warning',
    });
  } else if (projectMdStatus === 'missing-frontmatter') {
    actions.push({
      type: 'update',
      file: 'PROJECT.md',
      description: 'Add frontmatter block to PROJECT.md',
      severity: 'warning',
    });
  } else if (projectMdStatus === 'invalid-frontmatter') {
    actions.push({
      type: 'prompt',
      file: 'PROJECT.md',
      description: 'Fix invalid PROJECT.md frontmatter manually before adding',
      severity: 'error',
    });
  }

  if (!hasRoadmapMd) {
    actions.push({
      type: 'create',
      file: 'ROADMAP.md',
      description: 'Create ROADMAP.md skeleton',
      severity: 'info',
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
  if (catalogIdConflict) {
    actions.push({
      type: 'prompt',
      file: 'catalog',
      description: `Catalog id conflict for "${inferredId}"`,
      severity: 'error',
    });
  }
  if (localPathConflict) {
    actions.push({
      type: 'prompt',
      file: 'catalog',
      description: `Path already tracked by "${conflictingEntryId}"`,
      severity: 'error',
    });
  }
  if (!workspaceCheck.inside) {
    actions.push({
      type: 'prompt',
      file: 'settings',
      description: 'Folder is outside workspace roots; approval required before writes',
      severity: 'warning',
    });
  }
  if (repoInfo.isWorkingTreeDirty) {
    actions.push({
      type: 'prompt',
      file: '.git',
      description: 'Working tree is dirty; mutation requires explicit override',
      severity: 'warning',
    });
  }

  return {
    folderPath: resolvedFolderPath,
    folderName,
    isGitRepo: repoInfo.isGitRepo,
    gitBranch: repoInfo.gitBranch,
    gitRemote: repoInfo.gitRemote,
    hasProjectMd,
    projectMdStatus,
    hasRoadmapMd,
    hasAgentsMd,
    hasReadme,
    inferredTitle,
    inferredId,
    inferredStatus,
    detectedStatus,
    inferredRepo: repoInfo.gitRemote,
    catalogIdConflict,
    localPathConflict,
    conflictingEntryId,
    insideWorkspaceRoots: workspaceCheck.inside,
    matchedWorkspaceRoot: workspaceCheck.root,
    requiresWorkspaceApproval: !workspaceCheck.inside,
    isWorkingTreeDirty: repoInfo.isWorkingTreeDirty,
    dirtyPaths: repoInfo.dirtyPaths,
    actions,
  };
}

type CreateFlowInput = {
  title: string;
  folderName: string;
  workspaceRoot: string;
  workspaceRoots: string[];
  status: ProjectStatus;
  priority?: number;
  initializeGit: boolean;
  createRoadmap: boolean;
  createAgents: boolean;
};

function projectBodyTemplate(title: string): string {
  return `# ${title}

## Overview

Describe the purpose, scope, and current state of this project.
`;
}

function roadmapTemplate(title: string): string {
  return `# ROADMAP — ${title}

## Backlog

- [ ] Define first deliverable
`;
}

function agentsTemplate(title: string): string {
  return `# AGENTS.md — ${title}

Instructions for agents working on this project.
`;
}

async function writeCatalogLinkedEntry(args: {
  id: string;
  title: string;
  localPath: string;
  status: ProjectStatus;
  priority?: number;
}): Promise<string> {
  await withMutationRetry(() =>
    createProject(
      args.id,
      {
        id: args.id,
        title: args.title,
        type: 'project',
        trackingMode: 'linked',
        localPath: args.localPath,
        priority: args.priority,
        cachedStatus: args.status,
        cacheUpdatedAt: new Date().toISOString(),
      },
      '',
    ),
  );
  const projectsDir = await getProjectsDir();
  return `${projectsDir}/${args.id}.md`;
}

export async function createNewProjectFlow(
  input: CreateFlowInput,
  existingProjects: ProjectViewModel[],
): Promise<{ id: string; localPath: string }> {
  const title = input.title.trim();
  if (!title) throw new Error('Project title is required');

  const id = canonicalSlugify(input.folderName);
  if (isReservedProjectId(id)) {
    throw new Error(`"${id}" is reserved. Choose a different folder name.`);
  }
  if (existingProjects.some((project) => project.id === id)) {
    throw new Error(`A project with id "${id}" already exists`);
  }

  const resolvedRoot = await resolvePath(input.workspaceRoot);
  if (input.workspaceRoots.length > 0) {
    const policy = ensureInsideWorkspace(resolvedRoot, input.workspaceRoots);
    if (!policy.inside) {
      throw new Error('Selected workspace root is outside configured workspace roots');
    }
  }
  const localPath = `${resolvedRoot}/${id}`;
  if (await pathExists(localPath)) {
    throw new Error(`Target folder already exists: ${localPath}`);
  }

  const createdFiles: string[] = [];
  let catalogFilePath: string | null = null;
  let folderCreated = false;

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
    await withMutationRetry(() => writeFile(`${localPath}/PROJECT.md`, projectMarkdown));
    createdFiles.push('PROJECT.md');

    if (input.createRoadmap) {
      await withMutationRetry(() => writeFile(`${localPath}/ROADMAP.md`, roadmapTemplate(title)));
      createdFiles.push('ROADMAP.md');
    }
    if (input.createAgents) {
      await withMutationRetry(() => writeFile(`${localPath}/AGENTS.md`, agentsTemplate(title)));
      createdFiles.push('AGENTS.md');
    }

    await withMutationRetry(() =>
      writeFile(
        `${localPath}/.gitignore`,
        `node_modules\n.DS_Store\ndist\n.target\n`,
      ),
    );
    createdFiles.push('.gitignore');

    catalogFilePath = await writeCatalogLinkedEntry({
      id,
      title,
      localPath,
      status: input.status,
      priority: input.priority,
    });

    if (input.initializeGit) {
      await gitInitRepo(localPath, true, createdFiles);
    }

    return { id, localPath };
  } catch (error) {
    if (catalogFilePath) {
      const catalogPath = catalogFilePath;
      await withMutationRetry(() => removeProject(catalogPath)).catch(() => undefined);
    }
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
  addMissingRoadmap: boolean;
  addMissingAgents: boolean;
  initGitIfMissing: boolean;
  allowDirtyOverride: boolean;
};

export async function addExistingProjectFlow(
  input: AddExistingInput,
  existingProjects: ProjectViewModel[],
): Promise<{ id: string; localPath: string }> {
  if (input.report.projectMdStatus === 'invalid-frontmatter') {
    throw new Error('PROJECT.md frontmatter is invalid. Fix it before adding.');
  }
  if (input.report.localPathConflict) {
    throw new Error('This local path is already tracked.');
  }
  if (input.report.isWorkingTreeDirty && !input.allowDirtyOverride) {
    throw new Error('Repo is dirty. Enable override to continue.');
  }
  if (!input.report.insideWorkspaceRoots) {
    throw new Error('Selected folder is outside workspace roots. Update settings first.');
  }

  const id = canonicalSlugify(input.id);
  if (isReservedProjectId(id)) {
    throw new Error(`"${id}" is reserved. Choose a different id.`);
  }
  if (existingProjects.some((project) => project.id === id)) {
    throw new Error(`A project with id "${id}" already exists`);
  }

  const localPath = input.report.folderPath;
  const createdFilePaths: string[] = [];
  const backups = new Map<string, string>();
  let catalogFilePath: string | null = null;

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
    const projectPath = `${localPath}/PROJECT.md`;
    if (!input.report.hasProjectMd && input.addMissingProjectMd) {
      const projectMarkdown = matter.stringify(
        projectBodyTemplate(input.title),
        compactFrontmatter({
          title: input.title,
          status: input.fallbackStatus,
          type: 'project',
          lastActivity: new Date().toISOString().split('T')[0],
        }),
      );
      await writeWithBackup(projectPath, projectMarkdown);
    } else if (input.report.projectMdStatus === 'missing-frontmatter' && input.addMissingFrontmatter) {
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

    if (!input.report.hasRoadmapMd && input.addMissingRoadmap) {
      await writeWithBackup(`${localPath}/ROADMAP.md`, roadmapTemplate(input.title));
    }
    if (!input.report.hasAgentsMd && input.addMissingAgents) {
      await writeWithBackup(`${localPath}/AGENTS.md`, agentsTemplate(input.title));
    }

    catalogFilePath = await writeCatalogLinkedEntry({
      id,
      title: input.title,
      localPath,
      status: input.report.detectedStatus ?? input.fallbackStatus,
    });

    if (!input.report.isGitRepo && input.initGitIfMissing) {
      const filesForCommit = [
        'PROJECT.md',
        ...(input.addMissingRoadmap ? ['ROADMAP.md'] : []),
        ...(input.addMissingAgents ? ['AGENTS.md'] : []),
      ];
      await gitInitRepo(localPath, true, filesForCommit);
    }
    return { id, localPath };
  } catch (error) {
    for (const createdPath of createdFilePaths) {
      await withMutationRetry(() => removePath(createdPath)).catch(() => undefined);
    }
    for (const [filePath, content] of backups.entries()) {
      await withMutationRetry(() => writeFile(filePath, content)).catch(() => undefined);
    }
    if (catalogFilePath) {
      const catalogPath = catalogFilePath;
      await withMutationRetry(() => removeProject(catalogPath)).catch(() => undefined);
    }
    throw error;
  }
}

export async function runV2MigrationFlow(): Promise<MigrationReport> {
  return runArchitectureV2Migration();
}

export async function chooseFolder(initialPath?: string | null): Promise<string | null> {
  return pickFolder(initialPath);
}

export async function chooseWorkspaceRoot(settings: DashboardSettings | null): Promise<string | null> {
  const preferred = settings?.workspaceRoots[0] ?? null;
  return pickFolder(preferred);
}

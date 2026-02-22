import matter from 'gray-matter';
import type { DashboardError } from './errors';
import { fetchGitStatus } from './git';
import { buildHierarchy } from './hierarchy';
import { canonicalSlugify } from './project-flows';
import {
  VALID_STATUSES,
  isProjectStatus,
  isStale,
  needsReview,
  validateProject,
  type ProjectFrontmatter,
  type ProjectStatus,
  type ProjectViewModel,
} from './schema';
import { deleteFile, pathExists, readFile, scanProjects, writeFile } from './tauri';

/**
 * Extract "owner/repo" slug from a GitHub remote URL.
 * Handles HTTPS (https://github.com/owner/repo.git) and
 * SSH (git@github.com:owner/repo.git) formats.
 */
function extractGitHubSlug(remoteUrl?: string): string | undefined {
  if (!remoteUrl) return undefined;
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  return undefined;
}

export type ProjectUpdate = {
  [K in keyof ProjectFrontmatter]?: ProjectFrontmatter[K] | null;
};

export interface ProjectLoadResult {
  projects: ProjectViewModel[];
  errors: DashboardError[];
}

export async function getProjects(scanPaths: string[]): Promise<ProjectLoadResult> {
  const scanResult = await scanProjects(scanPaths);
  const projects: ProjectViewModel[] = [];
  const errors: DashboardError[] = [];

  // Surface scan-level errors
  for (const skipped of scanResult.skipped) {
    if (skipped.reason === 'not found') {
      errors.push({ type: 'scan_path_missing', path: skipped.path });
    } else if (skipped.reason === 'permission denied') {
      errors.push({ type: 'scan_path_permission_denied', path: skipped.path });
    }
  }

  // Read project metadata files: CLAWCHESTRA.md (preferred) or PROJECT.md (legacy)
  // Single pathExists check per project to avoid duplicate IPC calls
  const dirPaths = scanResult.projects;
  const projectFiles = await Promise.all(
    dirPaths.map(async (dir) => {
      const clawchestraExists = await pathExists(`${dir}/CLAWCHESTRA.md`);
      const filePath = clawchestraExists ? `${dir}/CLAWCHESTRA.md` : `${dir}/PROJECT.md`;
      // 5.19: Warn if both filenames exist in same directory
      if (clawchestraExists) {
        const legacyExists = await pathExists(`${dir}/PROJECT.md`);
        if (legacyExists) {
          console.warn(
            `[clawchestra] Both CLAWCHESTRA.md and PROJECT.md found in ${dir}. ` +
            'CLAWCHESTRA.md takes precedence. Delete PROJECT.md to resolve.'
          );
        }
      }
      try {
        const content = await readFile(filePath);
        return { filePath, content };
      } catch {
        return { filePath, content: null };
      }
    }),
  );

  // Track IDs for duplicate detection
  const idToDir = new Map<string, string[]>();

  for (let index = 0; index < dirPaths.length; index += 1) {
    const dirPath = dirPaths[index];
    const { filePath, content: raw } = projectFiles[index];

    if (raw === null) {
      errors.push({
        type: 'parse_failure',
        file: filePath,
        error: 'Could not read CLAWCHESTRA.md (or PROJECT.md)',
      });
      continue;
    }

    try {
      const { data, content } = matter(raw);
      const result = validateProject(data);

      if (!result.valid) {
        errors.push({
          type: 'parse_failure',
          file: filePath,
          error: result.errors.join(', '),
        });
        continue;
      }

      const frontmatter = result.data;
      const folderName = dirPath.split('/').pop() ?? dirPath;
      const id = canonicalSlugify(folderName);

      // Track for duplicate detection
      const existing = idToDir.get(id);
      if (existing) {
        existing.push(dirPath);
      } else {
        idToDir.set(id, [dirPath]);
      }

      // Detect companion files
      const roadmapFilePath = `${dirPath}/ROADMAP.md`;
      const changelogFilePath = `${dirPath}/CHANGELOG.md`;
      const gitDir = `${dirPath}/.git`;

      const [hasRoadmap, hasChangelog, hasGit] = await Promise.all([
        pathExists(roadmapFilePath),
        pathExists(changelogFilePath),
        pathExists(gitDir),
      ]);

      const gitStatus = hasGit ? await fetchGitStatus(dirPath) : undefined;

      // Auto-detect GitHub linkage: frontmatter repo field takes priority,
      // otherwise check if git remote points to GitHub
      const hasRepo = Boolean(frontmatter.repo) ||
        Boolean(gitStatus?.remote && gitStatus.remote.includes('github.com'));

      // Use git last commit date for staleness if frontmatter doesn't have lastActivity
      const lastActivity = frontmatter.lastActivity ?? gitStatus?.lastCommitDate?.split('T')[0];

      projects.push({
        id,
        filePath,
        dirPath,
        frontmatter,
        content,
        roadmapFilePath: hasRoadmap ? roadmapFilePath : undefined,
        hasRoadmap,
        changelogFilePath: hasChangelog ? changelogFilePath : undefined,
        hasChangelog,
        hasGit,
        gitStatus,
        children: [],
        isStale: isStale(lastActivity),
        needsReview: needsReview(frontmatter.lastReviewed),
        hasRepo,
        stateJsonMigrated: false, // Default — overridden from db.json during loadProjects merge
        title: frontmatter.title,
        status: frontmatter.status ?? 'pending',
        priority: frontmatter.priority,
        icon: frontmatter.icon,
        nextAction: frontmatter.nextAction,
        blockedBy: frontmatter.blockedBy,
        tags: frontmatter.tags,
      });
    } catch (error) {
      errors.push({
        type: 'parse_failure',
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown parse error',
      });
    }
  }

  // Report duplicate IDs
  for (const [id, dirs] of idToDir) {
    if (dirs.length > 1) {
      errors.push({ type: 'duplicate_project_id', id, paths: dirs });
    }
  }

  return { projects: buildHierarchy(projects), errors };
}

export async function updateProject(project: ProjectViewModel, updates: ProjectUpdate): Promise<void> {
  if (
    updates.status !== undefined &&
    updates.status !== null &&
    !isProjectStatus(updates.status)
  ) {
    throw new Error(`Invalid status: ${String(updates.status)}`);
  }

  const raw = await readFile(project.filePath);
  const { data, content } = matter(raw);
  const newData = { ...data };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (value === null) {
      delete newData[key];
    } else {
      newData[key] = value;
    }
  }

  newData.lastActivity = new Date().toISOString().split('T')[0];

  const result = validateProject(newData);
  if (!result.valid) {
    throw new Error(`Invalid update: ${result.errors.join(', ')}`);
  }

  const newContent = matter.stringify(content, result.data);
  await writeFile(project.filePath, newContent);
}

export async function createProject(
  dirPath: string,
  frontmatter: ProjectFrontmatter,
  content: string,
): Promise<void> {
  // New projects use CLAWCHESTRA.md (preferred filename)
  const filePath = `${dirPath}/CLAWCHESTRA.md`;
  const result = validateProject(frontmatter);
  if (!result.valid) {
    throw new Error(`Invalid project: ${result.errors.join(', ')}`);
  }

  const fileContent = matter.stringify(content, result.data);
  await writeFile(filePath, fileContent);
}

export async function removeProject(filePath: string): Promise<void> {
  await deleteFile(filePath);
}

export async function reorderProjects(
  orderedIds: string[],
  allProjects: ProjectViewModel[],
): Promise<void> {
  const updates = orderedIds
    .map((id, index) => {
      const project = allProjects.find((entry) => entry.id === id);
      if (project && project.frontmatter.priority !== index + 1) {
        return updateProject(project, { priority: index + 1 });
      }
      return null;
    })
    .filter((job): job is Promise<void> => job !== null);

  await Promise.all(updates);
}

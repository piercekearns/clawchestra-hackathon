import matter from 'gray-matter';
import type { DashboardError } from './errors';
import { fetchCommitActivity } from './github';
import { fetchGitStatus } from './git';
import { buildHierarchy } from './hierarchy';
import {
  VALID_STATUSES,
  isStale,
  needsReview,
  validateProject,
  validateRepoStatus,
  type ProjectFrontmatter,
  type ProjectStatus,
  type ProjectViewModel,
  type RepoStatus,
} from './schema';
import { deleteFile, getProjectsDir, listFiles, readFile, resolvePath, writeFile } from './tauri';

export type ProjectUpdate = {
  [K in keyof ProjectFrontmatter]?: ProjectFrontmatter[K] | null;
};

export interface ProjectLoadResult {
  projects: ProjectViewModel[];
  errors: DashboardError[];
}

const REPO_OWNED_FIELDS: ReadonlySet<keyof ProjectFrontmatter> = new Set([
  'title',
  'status',
  'nextAction',
  'blockedBy',
  'lastActivity',
] as const);

async function readRepoStatus(
  resolvedDir: string,
  statusFile = 'PROJECT.md',
): Promise<{ status: RepoStatus; content: string; resolvedPath: string } | null> {
  try {
    const filePath = `${resolvedDir}/${statusFile}`;
    const raw = await readFile(filePath);
    const { data, content } = matter(raw);
    const validated = validateRepoStatus(data);
    if (!validated) return null;

    return {
      status: validated,
      content,
      resolvedPath: filePath,
    };
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function syncDashboardLastActivity(
  project: ProjectViewModel,
  lastActivity: string,
): Promise<void> {
  try {
    const raw = await readFile(project.filePath);
    const { data, content } = matter(raw);
    const nextData = { ...data, lastActivity };
    const result = validateProject(nextData);
    if (!result.valid) return;
    const nextContent = matter.stringify(content, result.data);
    await writeFile(project.filePath, nextContent);
  } catch {
    // Best-effort sync only.
  }
}

function buildProjectId(filePath: string, projectsDir: string): string {
  return filePath.replace(`${projectsDir}/`, '').replace(/\.md$/, '');
}

export async function getProjects(): Promise<ProjectLoadResult> {
  const projectsDir = await getProjectsDir();
  const filePaths = await listFiles(projectsDir);
  const projects: ProjectViewModel[] = [];
  const errors: DashboardError[] = [];

  const rawFiles = await Promise.all(filePaths.map((filePath) => readFile(filePath)));

  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    const raw = rawFiles[index];

    try {
      const { data, content } = matter(raw);
      const frontmatter = (typeof data === 'object' && data !== null
        ? data
        : {}) as Record<string, unknown>;

      const hasProjectMarkers =
        typeof frontmatter.title === 'string' ||
        typeof frontmatter.status === 'string' ||
        typeof frontmatter.type === 'string';

      // Ignore markdown docs that are not project records.
      if (!hasProjectMarkers) continue;

      const result = validateProject(data);

      if (!result.valid) {
        errors.push({
          type: 'parse_failure',
          file: filePath,
          error: result.errors.join(', '),
        });
        continue;
      }

      const dashboardFrontmatter = result.data;
      const fallbackId = buildProjectId(filePath, projectsDir);
      const configuredId = dashboardFrontmatter.id?.trim();
      if (configuredId && configuredId !== fallbackId) {
        errors.push({
          type: 'parse_failure',
          file: filePath,
          error: `catalog id mismatch: frontmatter id "${configuredId}" must match filename "${fallbackId}"`,
        });
        continue;
      }
      const id = configuredId || fallbackId;

      let repoStatus: RepoStatus | undefined;
      let repoContent = content;
      let repoFilePath: string | undefined;
      let resolvedRepoDir: string | undefined;
      let roadmapFilePath: string | undefined;
      let hasRoadmap = false;
      let gitStatus;

      if (dashboardFrontmatter.trackingMode === 'linked' && dashboardFrontmatter.localPath) {
        resolvedRepoDir = await resolvePath(dashboardFrontmatter.localPath).catch(() => undefined);
        if (!resolvedRepoDir) {
          errors.push({
            type: 'repo_status_missing',
            localPath: dashboardFrontmatter.localPath,
            statusFile: dashboardFrontmatter.statusFile ?? 'PROJECT.md',
          });
        } else {
          const repoData = await readRepoStatus(
            resolvedRepoDir,
            dashboardFrontmatter.statusFile,
          );

          if (repoData) {
            repoStatus = repoData.status;
            repoContent = repoData.content;
            repoFilePath = repoData.resolvedPath;
          } else {
            errors.push({
              type: 'repo_status_missing',
              localPath: dashboardFrontmatter.localPath,
              statusFile: dashboardFrontmatter.statusFile ?? 'PROJECT.md',
            });
          }

          roadmapFilePath = `${resolvedRepoDir}/ROADMAP.md`;
          hasRoadmap = await pathExists(roadmapFilePath);
          gitStatus = await fetchGitStatus(resolvedRepoDir);
        }
      }

      const mergedTitle = repoStatus?.title ?? dashboardFrontmatter.title;
      const mergedStatus =
        repoStatus?.status
        ?? dashboardFrontmatter.status
        ?? dashboardFrontmatter.cachedStatus
        ?? 'simmering';
      const mergedNextAction =
        repoStatus?.nextAction !== undefined
          ? repoStatus.nextAction
          : (dashboardFrontmatter.nextAction ?? dashboardFrontmatter.cachedNextAction);
      const mergedBlockedBy =
        repoStatus?.blockedBy !== undefined
          ? repoStatus.blockedBy ?? undefined
          : dashboardFrontmatter.blockedBy;
      const mergedLastActivity = repoStatus?.lastActivity ?? dashboardFrontmatter.lastActivity;

      projects.push({
        id,
        filePath,
        frontmatter: dashboardFrontmatter,
        content: repoContent,
        repoStatus,
        repoFilePath,
        roadmapFilePath,
        hasRoadmap,
        gitStatus,
        children: [],
        isStale: isStale(mergedLastActivity),
        needsReview: needsReview(dashboardFrontmatter.lastReviewed),
        hasRepo: Boolean(dashboardFrontmatter.localPath && repoStatus),
        title: mergedTitle,
        status: mergedStatus,
        priority: dashboardFrontmatter.priority,
        icon: dashboardFrontmatter.icon,
        nextAction: mergedNextAction,
        blockedBy: mergedBlockedBy,
        tags: dashboardFrontmatter.tags,
      });
    } catch (error) {
      errors.push({
        type: 'parse_failure',
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown parse error',
      });
    }
  }

  const withRepoSlug = projects.filter((project) => Boolean(project.frontmatter.repo));
  await Promise.all(
    withRepoSlug.map(async (project) => {
      const repoSlug = project.frontmatter.repo;
      if (!repoSlug) return;

      const activity = await fetchCommitActivity(repoSlug);
      if (!activity) return;

      project.commitActivity = activity;
      const lastActivity = project.repoStatus?.lastActivity ?? project.frontmatter.lastActivity ?? activity.lastCommit;
      project.isStale = isStale(lastActivity);

      if (
        activity.lastCommit &&
        project.repoStatus?.lastActivity === undefined &&
        project.frontmatter.lastActivity !== activity.lastCommit
      ) {
        await syncDashboardLastActivity(project, activity.lastCommit);
      }
    }),
  );

  return { projects: buildHierarchy(projects), errors };
}

function ensureValidStatus(status: unknown): status is ProjectStatus {
  return typeof status === 'string' && VALID_STATUSES.includes(status as ProjectStatus);
}

export async function updateProject(project: ProjectViewModel, updates: ProjectUpdate): Promise<void> {
  const repoUpdates: Record<string, unknown> = {};
  const dashboardUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;

    if (project.hasRepo && REPO_OWNED_FIELDS.has(key as keyof ProjectFrontmatter)) {
      repoUpdates[key] = value;
    } else {
      dashboardUpdates[key] = value;
    }
  }

  if (Object.keys(repoUpdates).length > 0 && project.repoFilePath) {
    if (
      repoUpdates.status !== undefined &&
      repoUpdates.status !== null &&
      !ensureValidStatus(repoUpdates.status)
    ) {
      throw new Error(`Invalid status: ${String(repoUpdates.status)}`);
    }

    const raw = await readFile(project.repoFilePath);
    const { data, content } = matter(raw);
    const newData = { ...data };

    for (const [key, value] of Object.entries(repoUpdates)) {
      if (value === null) {
        delete newData[key];
      } else {
        newData[key] = value;
      }
    }

    newData.lastActivity = new Date().toISOString().split('T')[0];
    const newContent = matter.stringify(content, newData);
    await writeFile(project.repoFilePath, newContent);
  }

  if (Object.keys(dashboardUpdates).length > 0) {
    const raw = await readFile(project.filePath);
    const { data, content } = matter(raw);
    const newData = { ...data };

    for (const [key, value] of Object.entries(dashboardUpdates)) {
      if (value === null) {
        delete newData[key];
      } else {
        newData[key] = value;
      }
    }

    if (!project.hasRepo) {
      newData.lastActivity = new Date().toISOString().split('T')[0];
    }

    const result = validateProject(newData);
    if (!result.valid) {
      throw new Error(`Invalid update: ${result.errors.join(', ')}`);
    }

    const newContent = matter.stringify(content, result.data);
    await writeFile(project.filePath, newContent);
  }
}

export async function createProject(
  id: string,
  frontmatter: ProjectFrontmatter,
  content: string,
): Promise<void> {
  const projectsDir = await getProjectsDir();
  const normalizedId = id.trim().replace(/\s+/g, '-').toLowerCase();
  const filePath = `${projectsDir}/${normalizedId}.md`;
  const trackingMode = frontmatter.trackingMode
    ?? (frontmatter.localPath ? 'linked' : 'catalog-only');
  const nextFrontmatter: ProjectFrontmatter = {
    ...frontmatter,
    id: frontmatter.id ?? normalizedId,
    trackingMode,
  };

  const result = validateProject(nextFrontmatter);
  if (!result.valid) {
    throw new Error(`Invalid project: ${result.errors.join(', ')}`);
  }

  const finalId = result.data.id?.trim();
  if (!finalId || finalId !== normalizedId) {
    throw new Error('Invalid project: id must match the catalog filename');
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

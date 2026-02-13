import matter from 'gray-matter';
import type { DashboardError } from './errors';
import { fetchCommitActivity } from './github';
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

  // Read all PROJECT.md files in parallel
  const dirPaths = scanResult.projects;
  const projectMdPaths = dirPaths.map((dir) => `${dir}/PROJECT.md`);
  const rawFiles = await Promise.all(
    projectMdPaths.map((path) => readFile(path).catch(() => null)),
  );

  // Track IDs for duplicate detection
  const idToDir = new Map<string, string[]>();

  for (let index = 0; index < dirPaths.length; index += 1) {
    const dirPath = dirPaths[index];
    const filePath = projectMdPaths[index];
    const raw = rawFiles[index];

    if (raw === null) {
      errors.push({
        type: 'parse_failure',
        file: filePath,
        error: 'Could not read PROJECT.md',
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
      const hasRepo = Boolean(frontmatter.repo);

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
        isStale: isStale(frontmatter.lastActivity),
        needsReview: needsReview(frontmatter.lastReviewed),
        hasRepo,
        title: frontmatter.title,
        status: frontmatter.status ?? 'simmering',
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

  // Fetch commit activity for GitHub-linked projects
  const withRepoSlug = projects.filter((project) => Boolean(project.frontmatter.repo));
  await Promise.all(
    withRepoSlug.map(async (project) => {
      const repoSlug = project.frontmatter.repo;
      if (!repoSlug) return;

      const activity = await fetchCommitActivity(repoSlug);
      if (!activity) return;

      project.commitActivity = activity;
      const lastActivity = project.frontmatter.lastActivity ?? activity.lastCommit;
      project.isStale = isStale(lastActivity);
    }),
  );

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
  const filePath = `${dirPath}/PROJECT.md`;
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

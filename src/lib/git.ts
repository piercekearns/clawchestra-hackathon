import type { GitStatus, ProjectViewModel } from './schema';
import { getGitStatus as getGitStatusInvoke, gitCommit, gitFetch, gitPush } from './tauri';

export function gitStatusEmoji(status?: GitStatus): string {
  switch (status?.state) {
    case 'clean':
      return '🟢';
    case 'uncommitted':
      return '🟡';
    case 'unpushed':
      return '🔵';
    case 'behind':
      return '🔴';
    default:
      return '⚪';
  }
}

export async function fetchGitStatus(localPath?: string): Promise<GitStatus | undefined> {
  if (!localPath) return undefined;

  try {
    return await getGitStatusInvoke(localPath);
  } catch {
    return {
      state: 'unknown',
      details: 'Unable to read git status',
      stashCount: 0,
    };
  }
}

export async function commitPlanningDocs(
  localPath: string,
  message: string,
  files: string[] = ['CLAWCHESTRA.md'],
): Promise<void> {
  await gitCommit(localPath, message, files);
}

export async function pushRepo(localPath: string): Promise<void> {
  await gitPush(localPath);
}

export async function fetchAllRepos(projects: ProjectViewModel[]): Promise<void> {
  const gitProjects = projects.filter((p) => p.hasGit && p.gitStatus?.remote);
  const results = await Promise.allSettled(gitProjects.map((p) => gitFetch(p.dirPath)));
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.warn(`[Git] fetch failed for ${gitProjects[i].id}:`, result.reason);
    }
  }
}

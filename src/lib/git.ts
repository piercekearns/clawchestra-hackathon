import type { GitStatus } from './schema';
import { getGitStatus as getGitStatusInvoke, gitCommit, gitPush } from './tauri';

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
    };
  }
}

export async function commitPlanningDocs(
  localPath: string,
  message: string,
  files: string[] = ['PROJECT.md', 'ROADMAP.md'],
): Promise<void> {
  await gitCommit(localPath, message, files);
}

export async function pushRepo(localPath: string): Promise<void> {
  await gitPush(localPath);
}

import { gitCommit } from './tauri';
import type { GitStatus } from './schema';

/**
 * Auto-commit dashboard-managed files for local-only projects (no remote).
 * Silently commits metadata changes so users don't need to manually sync
 * projects that only exist locally.
 *
 * Returns the commit hash if committed, or null if skipped/failed.
 */
export async function autoCommitIfLocalOnly(
  dirPath: string,
  gitStatus: GitStatus | undefined,
  changedFiles: string[],
): Promise<string | null> {
  // Only auto-commit for local-only repos (no remote)
  if (!gitStatus || gitStatus.remote) return null;

  // Only auto-commit if the repo has git
  if (gitStatus.state === 'unknown') return null;

  try {
    const hash = await gitCommit(dirPath, 'chore: auto-sync project metadata', changedFiles);
    return hash;
  } catch {
    // Silently fail — auto-commit is best-effort
    console.warn(`[auto-commit] Failed for ${dirPath}`);
    return null;
  }
}

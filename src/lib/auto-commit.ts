import { gitCommit, getGitStatus } from './tauri';
import type { GitStatus } from './schema';

/** Allowed files for auto-commit — only structural Kanban paths. Never broaden this. */
const AUTO_COMMIT_ALLOWED = new Set(['PROJECT.md', 'ROADMAP.md']);

/**
 * Auto-commit structural Kanban changes for local-only projects (no remote).
 * Only commits PROJECT.md/ROADMAP.md status/priority moves. Skips if the
 * target files are not actually dirty (pre-existing-dirty guard).
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

  // Only auto-commit allowed structural files — never arbitrary code/docs
  const eligible = changedFiles.filter((f) => AUTO_COMMIT_ALLOWED.has(f));
  if (eligible.length === 0) return null;

  // Pre-existing-dirty guard: verify the target files are actually dirty
  // before committing. The backend git_commit now enforces this at the
  // Rust level too, but checking here provides a faster skip path.
  try {
    const freshStatus = await getGitStatus(dirPath);
    const allDirty = new Set(
      freshStatus.allDirtyFiles
        ? [
            ...freshStatus.allDirtyFiles.metadata,
            ...freshStatus.allDirtyFiles.documents,
            ...freshStatus.allDirtyFiles.code,
          ]
        : freshStatus.dirtyFiles ?? [],
    );
    const actuallyDirty = eligible.filter((f) => allDirty.has(f));
    if (actuallyDirty.length === 0) return null;
  } catch {
    // If we can't get fresh status, skip auto-commit to be safe
    console.warn(`[auto-commit] Could not verify dirty state for ${dirPath}, skipping`);
    return null;
  }

  try {
    const hash = await gitCommit(dirPath, 'chore: auto-sync project metadata', eligible);
    return hash;
  } catch {
    // Silently fail — auto-commit is best-effort
    console.warn(`[auto-commit] Failed for ${dirPath}`);
    return null;
  }
}

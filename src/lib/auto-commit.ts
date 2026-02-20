import { gitCommit } from './tauri';
import type { GitStatus } from './schema';

/** Allowed files for auto-commit — only structural Kanban paths. Never broaden this. */
const AUTO_COMMIT_ALLOWED = new Set(['PROJECT.md', 'ROADMAP.md']);

/**
 * Auto-commit structural Kanban changes for local-only projects (no remote).
 * Only commits PROJECT.md/ROADMAP.md status/priority moves.
 *
 * The backend git_commit enforces snapshot validation authoritatively —
 * the frontend dirty check is a fast-path skip to avoid unnecessary IPC.
 * Callers that just wrote files should pass `justWritten: true` to bypass
 * the stale gitStatus check (the file IS dirty, gitStatus just doesn't
 * know it yet).
 *
 * Returns the commit hash if committed, or null if skipped/failed.
 */
export async function autoCommitIfLocalOnly(
  dirPath: string,
  gitStatus: GitStatus | undefined,
  changedFiles: string[],
  opts?: { justWritten?: boolean },
): Promise<string | null> {
  // Only auto-commit for local-only repos (no remote)
  if (!gitStatus || gitStatus.remote) return null;

  // Only auto-commit if the repo has git
  if (gitStatus.state === 'unknown') return null;

  // Only auto-commit allowed structural files — never arbitrary code/docs
  const eligible = changedFiles.filter((f) => AUTO_COMMIT_ALLOWED.has(f));
  if (eligible.length === 0) return null;

  // If the caller just wrote these files, skip the dirty check — gitStatus
  // is stale and won't include the just-written file yet. The backend
  // git_commit validates authoritatively anyway.
  if (!opts?.justWritten) {
    const allDirty = new Set(
      gitStatus.allDirtyFiles
        ? [
            ...gitStatus.allDirtyFiles.metadata.map((e) => e.path),
            ...gitStatus.allDirtyFiles.documents.map((e) => e.path),
            ...gitStatus.allDirtyFiles.code.map((e) => e.path),
          ]
        : [],
    );
    const actuallyDirty = eligible.filter((f) => allDirty.has(f));
    if (actuallyDirty.length === 0) return null;
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

import { gitCommit } from './tauri';
import type { GitStatus } from './schema';

/** Allowed files for auto-commit — only structural Kanban paths. Never broaden this. */
const AUTO_COMMIT_ALLOWED = new Set(['PROJECT.md', 'ROADMAP.md']);

/**
 * Auto-commit structural Kanban changes for local-only projects (no remote).
 * Only commits PROJECT.md/ROADMAP.md status/priority moves. Skips if the
 * target files are not actually dirty per the provided gitStatus.
 *
 * The backend git_commit enforces snapshot validation authoritatively —
 * this frontend check is a fast-path skip to avoid unnecessary IPC.
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

  // Quick dirty check using the already-available gitStatus.
  // No extra IPC call — backend git_commit validates authoritatively.
  const allDirty = new Set(
    gitStatus.allDirtyFiles
      ? [
          ...gitStatus.allDirtyFiles.metadata,
          ...gitStatus.allDirtyFiles.documents,
          ...gitStatus.allDirtyFiles.code,
        ]
      : [],
  );
  const actuallyDirty = eligible.filter((f) => allDirty.has(f));
  if (actuallyDirty.length === 0) return null;

  try {
    const hash = await gitCommit(dirPath, 'chore: auto-sync project metadata', actuallyDirty);
    return hash;
  } catch {
    // Silently fail — auto-commit is best-effort
    console.warn(`[auto-commit] Failed for ${dirPath}`);
    return null;
  }
}

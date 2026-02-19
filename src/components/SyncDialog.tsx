import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  GitCommitHorizontal,
  HelpCircle,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './Tooltip';
import type { GitStatus, ProjectViewModel } from '../lib/schema';
import { gitCommit, gitPush } from '../lib/tauri';
import { cn } from '../lib/utils';
import { ModalDragZone } from './ui/ModalDragZone';

/* ── Brand checkbox: chartreuse bg + dark tick ─────────────────────── */
function BrandCheckbox({
  checked,
  onChange,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded border transition-colors',
        checked
          ? 'border-revival-accent-400 bg-revival-accent-400'
          : 'border-neutral-400 bg-transparent dark:border-neutral-500',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {checked && (
        <Check className="text-neutral-900" style={{ width: '75%', height: '75%' }} strokeWidth={3} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectViewModel[];
  onRequestChatPrefill: (text: string) => void;
  onSyncComplete: () => void;
}

interface SyncResult {
  projectId: string;
  success: boolean;
  hash?: string;
  error?: string;
  pushed?: boolean;
}

type DirtyProject = ProjectViewModel & { gitStatus: GitStatus };

function hasDirtyGitStatus(p: ProjectViewModel): p is DirtyProject {
  return p.gitStatus != null && (p.gitStatus.dashboardDirty === true);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBranchIndicator(git: GitStatus): { label: string; safe: boolean } {
  if (!git.remote) return { label: `${git.branch ?? '?'} (no remote)`, safe: false };
  const ahead = git.aheadCount ?? 0;
  const behind = git.behindCount ?? 0;
  if (ahead > 0 && behind > 0)
    return { label: `${git.branch} ↑${ahead} ↓${behind} ⚠`, safe: false };
  if (behind > 0) return { label: `${git.branch} ↓${behind} ⚠`, safe: false };
  if (ahead > 0) return { label: `${git.branch} ↑${ahead}`, safe: true };
  return { label: `${git.branch} ✓`, safe: true };
}

type FileCategory = 'metadata' | 'document';

export function categorizeFile(path: string): FileCategory {
  if (['PROJECT.md', 'ROADMAP.md', 'CHANGELOG.md'].includes(path)) return 'metadata';
  return 'document';
}

export function groupDirtyFiles(files: string[]): { metadata: string[]; documents: string[] } {
  const metadata: string[] = [];
  const documents: string[] = [];
  for (const f of files) {
    if (categorizeFile(f) === 'metadata') metadata.push(f);
    else documents.push(f);
  }
  return { metadata, documents };
}

export function buildCommitMessage(
  projects: { name: string; files: string[] }[],
): string {
  if (projects.length === 0) return 'chore: sync project metadata';

  const nameList =
    projects.length > 3
      ? `${projects.slice(0, 3).map((p) => p.name).join(', ')}, ...`
      : projects.map((p) => p.name).join(', ');

  // Collect unique files across all projects
  const allFiles = [...new Set(projects.flatMap((p) => p.files))];
  const filePart =
    allFiles.length > 0 && allFiles.length <= 4
      ? ` — ${allFiles.join(', ')}`
      : allFiles.length > 4
        ? ` — ${allFiles.slice(0, 3).join(', ')}, +${allFiles.length - 3} more`
        : '';

  return `chore: sync project metadata (${nameList})${filePart}`;
}

function buildHelpMessage(project: DirtyProject): string {
  const git = project.gitStatus;
  const behindPart = git.behindCount
    ? `, which is ${git.behindCount} commits behind remote`
    : '';
  return `${project.title} is on branch \`${git.branch}\`${behindPart}. The following dashboard files have uncommitted changes: ${git.dirtyFiles?.join(', ')}. Can you help me sync these?`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncDialog({
  open,
  onOpenChange,
  projects,
  onRequestChatPrefill,
  onSyncComplete,
}: SyncDialogProps) {
  // Type-narrow to projects with confirmed gitStatus
  const dirtyProjects = useMemo(
    () => projects.filter(hasDirtyGitStatus),
    [projects],
  );

  // Selected project IDs (all checked by default)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Push enabled per project
  const [pushEnabled, setPushEnabled] = useState<Set<string>>(new Set());
  // Sync results per project
  const [results, setResults] = useState<Map<string, SyncResult>>(new Map());
  // Currently syncing project ID (for spinner)
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // Batch syncing (state for UI rendering)
  const [batchSyncing, setBatchSyncing] = useState(false);
  // Ref-based mutex to prevent concurrent sync operations (double-click, individual+batch race)
  const syncLockRef = useRef(false);
  // Commit message
  const [commitMessage, setCommitMessage] = useState('');

  // Smart push defaults: derived from projects, stable across watcher reloads
  const defaultPushIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of dirtyProjects) {
      const { safe } = getBranchIndicator(p.gitStatus);
      if (safe) ids.add(p.id);
    }
    return ids;
  }, [dirtyProjects]);

  // Reset state only when dialog opens (not on project reloads)
  useEffect(() => {
    if (!open) return;

    setSelectedIds(new Set(dirtyProjects.map((p) => p.id)));
    setPushEnabled(defaultPushIds);
    setResults(new Map());
    setSyncingId(null);
    setBatchSyncing(false);
    syncLockRef.current = false;
    setCommitMessage(
      buildCommitMessage(
        dirtyProjects.map((p) => ({
          name: p.title,
          files: p.gitStatus.dirtyFiles ?? [],
        })),
      ),
    );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep default commit message in sync with selection changes
  // (only if user hasn't manually edited it)
  const userEditedCommitRef = useRef(false);
  useEffect(() => {
    if (!open || userEditedCommitRef.current) return;
    const selected = dirtyProjects.filter((p) => selectedIds.has(p.id));
    setCommitMessage(
      buildCommitMessage(
        selected.map((p) => ({
          name: p.title,
          files: p.gitStatus.dirtyFiles ?? [],
        })),
      ),
    );
  }, [selectedIds, open, dirtyProjects]);

  // Reset manual edit flag when dialog opens
  useEffect(() => {
    if (open) userEditedCommitRef.current = false;
  }, [open]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePush = useCallback((id: string) => {
    setPushEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedCount = useMemo(
    () => dirtyProjects.filter((p) => selectedIds.has(p.id) && !results.has(p.id)).length,
    [dirtyProjects, selectedIds, results],
  );

  // Sync a single project
  const syncProject = useCallback(
    async (project: DirtyProject): Promise<SyncResult> => {
      const git = project.gitStatus;
      if (!git.dirtyFiles?.length) {
        return { projectId: project.id, success: true, hash: 'no-op' };
      }

      try {
        const hash = await gitCommit(project.dirPath, commitMessage, git.dirtyFiles);
        let pushed = false;
        if (pushEnabled.has(project.id) && git.remote) {
          await gitPush(project.dirPath);
          pushed = true;
        }
        return { projectId: project.id, success: true, hash, pushed };
      } catch (error) {
        return { projectId: project.id, success: false, error: String(error) };
      }
    },
    [commitMessage, pushEnabled],
  );

  // Sync one project (per-project button)
  const handleSyncOne = useCallback(
    async (project: DirtyProject) => {
      if (syncLockRef.current) return;
      syncLockRef.current = true;
      try {
        setSyncingId(project.id);
        const result = await syncProject(project);
        setResults((prev) => new Map(prev).set(project.id, result));
        setSyncingId(null);
      } finally {
        syncLockRef.current = false;
      }
    },
    [syncProject],
  );

  // Batch sync all selected
  const handleSyncAll = useCallback(async () => {
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setBatchSyncing(true);
    try {
      const toSync = dirtyProjects.filter(
        (p) => selectedIds.has(p.id) && !results.has(p.id),
      );
      for (const project of toSync) {
        setSyncingId(project.id);
        const result = await syncProject(project);
        setResults((prev) => new Map(prev).set(project.id, result));
      }
      setSyncingId(null);
      setBatchSyncing(false);
    } finally {
      syncLockRef.current = false;
    }
  }, [dirtyProjects, selectedIds, results, syncProject]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // If any syncs happened, refresh projects
    if (results.size > 0) {
      onSyncComplete();
    }
  }, [onOpenChange, onSyncComplete, results.size]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <ModalDragZone />
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-200 bg-neutral-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-700">
          <div>
            <h2 className="text-lg font-semibold">Sync Changes</h2>
            <p className="text-sm text-neutral-500">
              {dirtyProjects.length} project{dirtyProjects.length !== 1 ? 's' : ''} with uncommitted changes
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Project list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-3">
            {dirtyProjects.map((project) => {
              const git = project.gitStatus;
              const branch = getBranchIndicator(git);
              const result = results.get(project.id);
              const isSyncing = syncingId === project.id;
              const { metadata, documents } = groupDirtyFiles(git.dirtyFiles ?? []);

              return (
                <div
                  key={project.id}
                  className={`rounded-lg border px-3 py-2.5 ${
                    result?.success
                      ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30'
                      : result && !result.success
                        ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30'
                        : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {/* Top row: checkbox, name, branch, action */}
                  <div className="flex items-center gap-2">
                    {!result && (
                      <BrandCheckbox
                        checked={selectedIds.has(project.id)}
                        onChange={() => toggleSelected(project.id)}
                        className="h-4 w-4"
                        disabled={isSyncing || batchSyncing}
                      />
                    )}
                    {result?.success && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                    {result && !result.success && <X className="h-4 w-4 shrink-0 text-red-500" />}

                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {project.frontmatter.icon ? `${project.frontmatter.icon} ` : ''}
                      {project.title}
                    </span>

                    {/* Branch indicator */}
                    <span
                      className={`shrink-0 text-xs ${
                        branch.safe
                          ? 'text-neutral-500 dark:text-neutral-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {branch.label}
                    </span>

                    {/* Action button — only visible when project is selected */}
                    {!result && selectedIds.has(project.id) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSyncing || batchSyncing}
                        onClick={() => handleSyncOne(project)}
                        className="shrink-0 text-xs"
                      >
                        {isSyncing ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <GitCommitHorizontal className="mr-1 h-3 w-3" />
                        )}
                        {pushEnabled.has(project.id) && git.remote
                          ? 'Commit & Push'
                          : 'Commit'}
                      </Button>
                    )}

                    {result?.success && (
                      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
                        {result.hash}
                        {result.pushed ? ' (pushed)' : ''}
                      </span>
                    )}
                  </div>

                  {/* Push toggle — only visible when project is selected */}
                  {!result && git.remote && selectedIds.has(project.id) && (
                    <div className="ml-6 mt-1 inline-flex items-center gap-1.5 text-xs text-neutral-500">
                      <BrandCheckbox
                        checked={pushEnabled.has(project.id)}
                        onChange={() => togglePush(project.id)}
                        className="h-3.5 w-3.5"
                        disabled={isSyncing || batchSyncing}
                      />
                      <span
                        className="cursor-pointer select-none"
                        onClick={() => { if (!isSyncing && !batchSyncing) togglePush(project.id); }}
                      >
                        Push after commit
                      </span>
                      {!branch.safe && (
                        <Tooltip text="Branch is behind or diverged — push may fail">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        </Tooltip>
                      )}
                    </div>
                  )}

                  {/* Dirty files grouped */}
                  <div className="ml-6 mt-1.5 space-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {metadata.length > 0 && (
                      <div>
                        <span className="font-medium text-neutral-600 dark:text-neutral-300">
                          Metadata:
                        </span>{' '}
                        {metadata.join(', ')}
                      </div>
                    )}
                    {documents.length > 0 && (
                      <div>
                        <span className="font-medium text-neutral-600 dark:text-neutral-300">
                          Documents:
                        </span>{' '}
                        {documents.join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Warning + help for unsafe branches */}
                  {!branch.safe && !result && (
                    <div className="ml-6 mt-1.5 flex items-center gap-2 text-xs">
                      <span className="text-amber-600 dark:text-amber-400">
                        ⚠ Branch is {(git.behindCount ?? 0) > 0 && (git.aheadCount ?? 0) > 0 ? 'diverged' : 'behind remote'}
                        {' '}— push may fail
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-revival-accent-400 hover:underline"
                        onClick={() => onRequestChatPrefill(buildHelpMessage(project))}
                      >
                        <HelpCircle className="h-3 w-3" />
                        Ask agent to help
                      </button>
                    </div>
                  )}

                  {/* Error state */}
                  {result && !result.success && (
                    <div className="ml-6 mt-1.5 space-y-1 text-xs">
                      <div className="text-red-600 dark:text-red-400">{result.error}</div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-revival-accent-400 hover:underline"
                        onClick={() => onRequestChatPrefill(buildHelpMessage(project))}
                      >
                        <HelpCircle className="h-3 w-3" />
                        Ask agent to help
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Commit message + actions */}
        <div className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-700">
          <label className="mb-2 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Commit message
          </label>
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => { userEditedCommitRef.current = true; setCommitMessage(e.target.value); }}
            disabled={batchSyncing}
            className="mb-3 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-revival-accent-400 focus:outline-none focus:ring-1 focus:ring-revival-accent-400 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="chore: sync project metadata"
          />

          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>
              {results.size > 0 ? 'Done' : 'Cancel'}
            </Button>

            {selectedCount > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={batchSyncing || !commitMessage.trim()}
                onClick={handleSyncAll}
              >
                {batchSyncing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <GitCommitHorizontal className="mr-1.5 h-4 w-4" />
                )}
                Sync All Selected ({selectedCount})
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

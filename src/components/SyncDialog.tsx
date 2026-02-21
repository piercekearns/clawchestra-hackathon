import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  HelpCircle,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './Tooltip';
import type { DirtyFileCategory, GitBranchState, GitStatus, ProjectViewModel } from '../lib/schema';
import {
  gitApplyConflictResolution,
  gitAbortCherryPick,
  gitCherryPickCommit,
  gitCheckoutBranch,
  gitCommit,
  gitGetConflictContext,
  gitGetBranchStates,
  getGitStatus,
  gitPopStash,
  gitPullCurrent,
  gitPush,
  gitStashPush,
  gitSyncLockAcquire,
  gitSyncLockRelease,
  gitValidateBranchSyncResume,
  sendOpenClawMessage,
} from '../lib/tauri';
import { cn } from '../lib/utils';
import { ModalDragZone } from './ui/ModalDragZone';
import {
  buildCommitMessage,
  CATEGORY_LABELS,
  clearExecutionState,
  filesForSelectedCategories,
  getBranchIndicator,
  getProjectDirtyCategories,
  getTargetBranchIndicator,
  isFailedSyncStep,
  parseGitError,
  readExecutionState,
  writeExecutionState,
  type BranchSyncExecutionState,
} from '../lib/git-sync-utils';

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
        <Check className="text-neutral-900" style={{ width: '75%', height: '75%' }} strokeWidth={3} strokeLinejoin="miter" strokeLinecap="square" />
      )}
    </button>
  );
}

/* ── Branch picker dropdown ────────────────────────────────────────── */
function BranchPicker({
  git,
  branch,
  branchTargets,
  selectedTargets,
  selectedTargetPush,
  pushEnabled,
  pullFirstEnabled,
  hasAnySelected,
  projectId,
  togglePush,
  togglePullFirst,
  toggleTargetBranch,
  toggleTargetPush,
  disabled,
}: {
  git: GitStatus;
  branch: { label: string; safe: boolean };
  branchTargets: GitBranchState[];
  selectedTargets: Set<string>;
  selectedTargetPush: Set<string>;
  pushEnabled: boolean;
  pullFirstEnabled: boolean;
  hasAnySelected: boolean;
  projectId: string;
  togglePush: (id: string) => void;
  togglePullFirst: (id: string) => void;
  toggleTargetBranch: (id: string, branch: string) => void;
  toggleTargetPush: (id: string, branch: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target)
        && dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [open]);

  const targetCount = selectedTargets.size;

  // Compute fixed position from button rect
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
          branch.safe
            ? 'border-transparent text-neutral-500 hover:border-neutral-200 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800'
            : 'border-transparent text-amber-600 hover:border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:hover:border-amber-800 dark:hover:bg-amber-950/40',
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <GitBranch className="h-3 w-3" />
        {git.branch ?? '?'}{!branch.safe && ' ⚠'}
        {targetCount > 0 && (
          <span className="font-medium text-revival-accent-400">+{targetCount}</span>
        )}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && pos && (
        <div
          ref={dropdownRef}
          className="fixed z-[100] min-w-[14rem] max-h-[300px] overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-0 py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style={{ top: pos.top, right: pos.right }}
        >
          {/* Source branch — always checked, not deselectable */}
          <div className="px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <BrandCheckbox checked disabled className="h-3.5 w-3.5" onChange={() => {}} />
              <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                {git.branch ?? '?'}
              </span>
              <span className="text-[10px] text-neutral-400">source</span>
            </div>

            {/* Pull first (nested under source) */}
            {git.remote && (git.behindCount ?? 0) > 0 && (
              <div className="ml-5 mt-1 inline-flex items-center gap-1.5">
                <BrandCheckbox
                  checked={pullFirstEnabled}
                  onChange={() => togglePullFirst(projectId)}
                  className="h-3 w-3"
                  disabled={disabled}
                />
                <span
                  className="cursor-pointer select-none text-xs text-neutral-500"
                  onClick={() => { if (!disabled) togglePullFirst(projectId); }}
                >
                  Pull first ({git.behindCount} behind)
                </span>
              </div>
            )}

            {/* Push after commit (nested under source) */}
            {git.remote && hasAnySelected && (
              <div className="ml-5 mt-1 inline-flex items-center gap-1.5">
                <BrandCheckbox
                  checked={pushEnabled}
                  onChange={() => togglePush(projectId)}
                  className="h-3 w-3"
                  disabled={disabled}
                />
                <span
                  className="cursor-pointer select-none text-xs text-neutral-500"
                  onClick={() => { if (!disabled) togglePush(projectId); }}
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
          </div>

          {/* Cherry-pick targets */}
          {branchTargets.length > 0 && (
            <>
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
              <div className="px-3 py-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                  Cherry-pick to
                </span>
              </div>
              {branchTargets.map((target) => {
                const targetIndicator = getTargetBranchIndicator(target);
                const checked = selectedTargets.has(target.name);
                return (
                  <div key={target.name} className="px-3 py-1">
                    <div className="flex items-center gap-1.5">
                      <BrandCheckbox
                        checked={checked}
                        onChange={() => toggleTargetBranch(projectId, target.name)}
                        className="h-3.5 w-3.5"
                        disabled={disabled}
                      />
                      <span
                        className="cursor-pointer select-none text-xs text-neutral-600 dark:text-neutral-300"
                        onClick={() => { if (!disabled) toggleTargetBranch(projectId, target.name); }}
                      >
                        {target.name}
                      </span>
                      {target.localOnly && (
                        <span className="text-[10px] text-neutral-400">(local)</span>
                      )}
                      {!target.localOnly && !targetIndicator.safe && (
                        <Tooltip text="This branch is behind or diverged; cherry-pick may conflict">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        </Tooltip>
                      )}
                    </div>
                    {checked && target.hasUpstream && (
                      <div className="ml-5 mt-1 inline-flex items-center gap-1.5">
                        <BrandCheckbox
                          checked={selectedTargetPush.has(target.name)}
                          onChange={() => toggleTargetPush(projectId, target.name)}
                          className="h-3 w-3"
                          disabled={disabled}
                        />
                        <span
                          className="cursor-pointer select-none text-[11px] text-neutral-500"
                          onClick={() => { if (!disabled) toggleTargetPush(projectId, target.name); }}
                        >
                          Push after cherry-pick
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Git error details (collapsible summary + raw output) ──────────── */
function GitErrorDetails({ raw, className }: { raw: string; className?: string }) {
  const summary = parseGitError(raw);
  return (
    <details className={className}>
      <summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-300">
        {summary}
      </summary>
      <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap rounded border border-neutral-700 bg-neutral-950/50 px-2 py-1.5 font-mono text-[10px] text-neutral-400">
        {raw}
      </pre>
    </details>
  );
}

/* ── GitHub repo name parser ────────────────────────────────────────── */
function parseGitHubRepo(remote?: string): string | null {
  if (!remote) return null;
  // Handles https://github.com/org/repo.git and git@github.com:org/repo.git
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

/* ── Collapsible category file list ─────────────────────────────────── */
function CategoryFiles({
  category,
  files,
  checked,
  disabled,
  onToggle,
}: {
  category: DirtyFileCategory;
  files: { path: string; status: string }[];
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <BrandCheckbox
          checked={checked}
          onChange={onToggle}
          className="h-3.5 w-3.5"
          disabled={disabled}
        />
        <button
          type="button"
          className="flex items-center gap-0.5 text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          <span className="font-medium">
            {CATEGORY_LABELS[category]} ({files.length})
          </span>
        </button>
      </div>
      {expanded && (
        <div className="ml-[1.375rem] mt-0.5 space-y-px">
          {files.map((f) => (
            <div key={f.path} className="inline-flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="truncate">{f.path}</span>
              <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{f.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
  branchResults?: BranchExecutionResult[];
  conflict?: ConflictContext;
}

interface BranchExecutionResult {
  branch: string;
  status: 'success' | 'skipped' | 'conflict' | 'failed';
  hash?: string;
  pushed?: boolean;
  reason?: string;
}

interface ConflictContext {
  sourceBranch: string;
  targetBranch: string;
  commitHash: string;
  files: string[];
  details: string;
}

interface ConflictResolutionDraft {
  path: string;
  strategy: string;
  summary: string;
  proposedContent: string;
  currentContent: string;
}

type DirtyProject = ProjectViewModel & { gitStatus: GitStatus };

function hasDirtyGitStatus(p: ProjectViewModel): p is DirtyProject {
  return p.gitStatus != null && p.gitStatus.hasDirtyFiles === true;
}

// ---------------------------------------------------------------------------
// Helpers (pure functions in ../lib/git-sync-utils.ts)
// ---------------------------------------------------------------------------

function buildHelpMessage(project: DirtyProject): string {
  const git = project.gitStatus;
  const behindPart = git.behindCount
    ? `, which is ${git.behindCount} commits behind remote`
    : '';
  const cats = getProjectDirtyCategories(git);
  const allFiles = [...cats.metadata, ...cats.documents, ...cats.code];
  return `${project.title} is on branch \`${git.branch}\`${behindPart}. The following files have uncommitted changes: ${allFiles.join(', ')}. Can you help me sync these?`;
}

function buildConflictPrefill(
  project: DirtyProject,
  conflict: ConflictContext,
): string {
  return [
    `I hit a cherry-pick conflict while syncing ${project.title}.`,
    `Source branch: ${conflict.sourceBranch}`,
    `Target branch: ${conflict.targetBranch}`,
    `Commit: ${conflict.commitHash}`,
    `Conflicting files: ${conflict.files.join(', ') || '(none detected)'}`,
    '',
    'Please propose a safe non-destructive resolution strategy and exact git steps.',
    'If structured files are involved, preserve all roadmap/spec/plan content and deduplicate.',
    '',
    `Git output:`,
    conflict.details || '(no details)',
  ].join('\n');
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) return trimmed;
  const lastFence = trimmed.lastIndexOf('```');
  if (lastFence <= firstNewline) return trimmed;
  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

function truncateForPrompt(text: string, maxChars = 10_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} chars]`;
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

  // Per-project category selections: which categories are checked
  const [selectedCategories, setSelectedCategories] = useState<
    Map<string, Set<DirtyFileCategory>>
  >(new Map());
  // Push enabled per project
  const [pushEnabled, setPushEnabled] = useState<Set<string>>(new Set());
  // Optional pull-first for source branch when behind
  const [pullFirstEnabled, setPullFirstEnabled] = useState<Set<string>>(new Set());
  // Additional branch targets per project
  const [targetBranches, setTargetBranches] = useState<Map<string, Set<string>>>(new Map());
  // Per-project target branch push toggles
  const [targetPushEnabled, setTargetPushEnabled] = useState<Map<string, Set<string>>>(new Map());
  // Branch state snapshots for each project
  const [branchStatesByProject, setBranchStatesByProject] = useState<Map<string, GitBranchState[]>>(new Map());
  // Persisted interrupted execution states
  const [executionStateByProject, setExecutionStateByProject] = useState<Map<string, BranchSyncExecutionState>>(new Map());

  // Include projects with persisted unresolved state (even if not dirty)
  const syncProjects = useMemo(() => {
    const dirtyIds = new Set(dirtyProjects.map((p) => p.id));
    const unresolvedExtras = projects.filter((p): p is DirtyProject => {
      if (dirtyIds.has(p.id)) return false;
      if (!p.gitStatus) return false;
      const state = executionStateByProject.get(p.id);
      return state != null && isFailedSyncStep(state.currentStep);
    });
    return [...dirtyProjects, ...unresolvedExtras];
  }, [dirtyProjects, executionStateByProject, projects]);

  // In-dialog conflict resolution drafts
  const [conflictDraftsByProject, setConflictDraftsByProject] = useState<Map<string, ConflictResolutionDraft[]>>(new Map());
  const [loadingConflictDraftIds, setLoadingConflictDraftIds] = useState<Set<string>>(new Set());
  const [applyingConflictId, setApplyingConflictId] = useState<string | null>(null);
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

  /** Build default category selections — select all non-empty categories */
  const buildDefaultCategories = useCallback(
    (projs: DirtyProject[]) => {
      const map = new Map<string, Set<DirtyFileCategory>>();
      for (const p of projs) {
        const cats = getProjectDirtyCategories(p.gitStatus);
        const selected = new Set<DirtyFileCategory>();
        if (cats.metadata.length > 0) selected.add('metadata');
        if (cats.documents.length > 0) selected.add('documents');
        // Code is NOT selected by default (higher risk)
        map.set(p.id, selected);
      }
      return map;
    },
    [],
  );

  /** Compute commit message inputs from selections, excluding already-synced projects */
  const computeCommitInputs = useCallback(
    (
      cats: Map<string, Set<DirtyFileCategory>>,
      projs: DirtyProject[],
      excludeIds: Set<string>,
    ) => {
      return projs
        .filter((p) => {
          const sel = cats.get(p.id);
          return sel && sel.size > 0 && !excludeIds.has(p.id);
        })
        .map((p) => {
          const projCats = getProjectDirtyCategories(p.gitStatus);
          const sel = cats.get(p.id)!;
          return {
            name: p.title,
            files: filesForSelectedCategories(projCats, sel),
            categories: sel,
          };
        });
    },
    [],
  );

  // Reset all state when dialog opens (not on project reloads).
  // Dependencies intentionally limited to `open`: reacting to dirtyProjects or
  // defaultPushIds changes mid-session would discard user selections.
  const userEditedCommitRef = useRef(false);
  useEffect(() => {
    if (!open) return;

    const defaultCats = buildDefaultCategories(dirtyProjects);
    setSelectedCategories(defaultCats);
    setPushEnabled(defaultPushIds);
    setPullFirstEnabled(new Set());
    setTargetBranches(new Map());
    setTargetPushEnabled(new Map());
    setBranchStatesByProject(new Map());
    const persisted = new Map<string, BranchSyncExecutionState>();
    for (const project of projects) {
      const existing = readExecutionState(project.id);
      if (existing) persisted.set(project.id, existing);
    }
    setExecutionStateByProject(persisted);
    setConflictDraftsByProject(new Map());
    setLoadingConflictDraftIds(new Set());
    setApplyingConflictId(null);
    setResults(new Map());
    setSyncingId(null);
    setBatchSyncing(false);
    syncLockRef.current = false;
    userEditedCommitRef.current = false;
    setCommitMessage(
      buildCommitMessage(computeCommitInputs(defaultCats, dirtyProjects, new Set())),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps intentionally
  // limited to `open` only: we want a full reset on dialog open, not on every
  // project/category change (which would discard user selections mid-session).
  }, [open]);

  // Keep default commit message in sync with selection changes
  // (only if user hasn't manually edited it)
  useEffect(() => {
    if (!open || userEditedCommitRef.current) return;
    setCommitMessage(
      buildCommitMessage(computeCommitInputs(selectedCategories, dirtyProjects, new Set(results.keys()))),
    );
  }, [selectedCategories, open, dirtyProjects, results, computeCommitInputs]);

  // Load branch states lazily for branch-target selection UI.
  // Depends only on `open` — NOT on syncProjects — because updateExecutionState
  // fires on every sync step, which would change syncProjects identity and trigger
  // redundant gitGetBranchStates IPC calls for ALL projects mid-sync.
  // Individual project refreshes after sync use refreshBranchStatesForProject.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const projectsToLoad = syncProjects; // snapshot from current render
    const loadBranchStates = async () => {
      const entries = await Promise.all(
        projectsToLoad.map(async (project) => {
          try {
            const states = await gitGetBranchStates(project.dirPath);
            return [project.id, states] as const;
          } catch {
            return [project.id, [] as GitBranchState[]] as const;
          }
        }),
      );
      if (cancelled) return;
      setBranchStatesByProject(new Map(entries));
    };

    void loadBranchStates();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally open-only;
  // syncProjects is captured as a snapshot. Mid-sync step changes should NOT reload
  // all branch states; refreshBranchStatesForProject handles targeted reloads.
  }, [open]);

  const refreshBranchStatesForProject = useCallback(async (project: DirtyProject) => {
    try {
      const states = await gitGetBranchStates(project.dirPath);
      setBranchStatesByProject((prev) => new Map(prev).set(project.id, states));
    } catch {
      // leave previous snapshot in place on refresh failure
    }
  }, []);

  const toggleCategory = useCallback((projectId: string, category: DirtyFileCategory) => {
    setSelectedCategories((prev) => {
      const next = new Map(prev);
      const cats = new Set(prev.get(projectId) ?? []);
      if (cats.has(category)) cats.delete(category);
      else cats.add(category);
      next.set(projectId, cats);
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

  const togglePullFirst = useCallback((projectId: string) => {
    setPullFirstEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleTargetBranch = useCallback((projectId: string, branch: string) => {
    setTargetBranches((prev) => {
      const next = new Map(prev);
      const selected = new Set(prev.get(projectId) ?? []);
      if (selected.has(branch)) selected.delete(branch);
      else selected.add(branch);
      next.set(projectId, selected);
      return next;
    });
  }, []);

  const toggleTargetPush = useCallback((projectId: string, branch: string) => {
    setTargetPushEnabled((prev) => {
      const next = new Map(prev);
      const selected = new Set(prev.get(projectId) ?? []);
      if (selected.has(branch)) selected.delete(branch);
      else selected.add(branch);
      next.set(projectId, selected);
      return next;
    });
  }, []);

  /** Whether a project has any categories selected */
  const isProjectSelected = useCallback(
    (projectId: string) => {
      const cats = selectedCategories.get(projectId);
      return cats != null && cats.size > 0;
    },
    [selectedCategories],
  );

  const selectedCount = useMemo(
    () =>
      syncProjects.filter(
        (p) =>
          (isProjectSelected(p.id)
            || Boolean(
              executionStateByProject.get(p.id)?.commitHash
              && executionStateByProject.get(p.id)?.remainingTargets.length
              && executionStateByProject.get(p.id)?.currentStep !== 'conflict',
            ))
          && !results.has(p.id),
      ).length,
    [syncProjects, executionStateByProject, isProjectSelected, results],
  );

  const selectedCommitCount = useMemo(
    () => syncProjects.filter((p) => isProjectSelected(p.id) && !results.has(p.id)).length,
    [syncProjects, isProjectSelected, results],
  );

  // Sync a single project
  const syncProject = useCallback(
    async (project: DirtyProject): Promise<SyncResult> => {
      const persisted = readExecutionState(project.id);
      let shouldResume = Boolean(
        persisted && persisted.commitHash && persisted.remainingTargets.length > 0,
      );
      const cats = getProjectDirtyCategories(project.gitStatus);
      const sel = selectedCategories.get(project.id);
      if ((!sel || sel.size === 0) && !shouldResume) {
        return { projectId: project.id, success: true, hash: 'no-op' };
      }
      const files = filesForSelectedCategories(cats, sel ?? new Set<DirtyFileCategory>());
      if (files.length === 0 && !shouldResume) {
        return { projectId: project.id, success: true, hash: 'no-op' };
      }

      const fallbackSourceBranch = project.gitStatus.branch ?? 'HEAD';
      const selectedTargets = [...(targetBranches.get(project.id) ?? new Set<string>())];
      const perBranchResults: BranchExecutionResult[] = [];
      let resumedState = shouldResume ? persisted : null;

      const clearPersistedState = () => {
        clearExecutionState(project.id);
        setExecutionStateByProject((prev) => {
          const next = new Map(prev);
          next.delete(project.id);
          return next;
        });
      };

      if (resumedState) {
        const resumeValidation = await gitValidateBranchSyncResume({
          repoPath: project.dirPath,
          sourceBranch: resumedState.sourceBranch,
          commitHash: resumedState.commitHash ?? '',
          remainingTargets: resumedState.remainingTargets,
        }).catch((error) => ({
          valid: false,
          reasons: [String(error)],
          currentBranch: undefined,
          missingTargets: [],
          cherryPickInProgress: false,
          unresolvedConflicts: false,
        }));

        if (!resumeValidation.valid) {
          clearPersistedState();
          resumedState = null;
          shouldResume = false;
          if (!sel || sel.size === 0) {
            return {
              projectId: project.id,
              success: false,
              error: `Saved sync state is no longer resumable: ${resumeValidation.reasons.join('; ')}`,
            };
          }
        }
      }

      const sourceBranch = resumedState?.sourceBranch ?? fallbackSourceBranch;
      const resumeTargets = resumedState ? [...resumedState.remainingTargets] : selectedTargets;
      const targetPushBranches = new Set(
        resumedState?.targetPushBranches ?? [...(targetPushEnabled.get(project.id) ?? new Set<string>())],
      );
      const sourcePushSelected = resumedState?.sourcePushEnabled
        ?? (pushEnabled.has(project.id) && Boolean(project.gitStatus.remote));
      let commitHash = resumedState?.commitHash;
      let sourcePushed = resumedState?.sourcePushed ?? false;
      let branchSyncLockToken: string | null = null;

      const updateExecutionState = (
        next: Omit<BranchSyncExecutionState, 'projectId' | 'updatedAt'>,
      ) => {
        const payload: BranchSyncExecutionState = {
          projectId: project.id,
          updatedAt: Date.now(),
          ...next,
          completedTargets: [...next.completedTargets],
          remainingTargets: [...next.remainingTargets],
        };
        writeExecutionState(project.id, payload);
        setExecutionStateByProject((prev) => new Map(prev).set(project.id, payload));
      };

      try {
        branchSyncLockToken = await gitSyncLockAcquire(project.dirPath);
      } catch (error) {
        return {
          projectId: project.id,
          success: false,
          error: String(error),
        };
      }

      try {
        if (!resumedState) {
          updateExecutionState({
            sourceBranch,
            currentStep: 'source-commit',
            completedTargets: [],
            remainingTargets: resumeTargets,
            targetPushBranches: [...targetPushBranches],
            sourcePushEnabled: sourcePushSelected,
            sourcePushed,
          });
        }

        if (!resumedState && pullFirstEnabled.has(project.id) && (project.gitStatus.behindCount ?? 0) > 0) {
          updateExecutionState({
            sourceBranch,
            currentStep: 'pull-first',
            completedTargets: [],
            remainingTargets: resumeTargets,
            targetPushBranches: [...targetPushBranches],
            sourcePushEnabled: sourcePushSelected,
            sourcePushed,
          });
          const prePullStash = await gitStashPush(
            project.dirPath,
            true,
            `clawchestra-pull-first:${project.id}`,
          );
          try {
            await gitPullCurrent(project.dirPath);
          } finally {
            if (prePullStash.stashed) {
              await gitPopStash(project.dirPath, prePullStash.stashRef ?? null);
            }
          }
        }

        if (!commitHash) {
          commitHash = await gitCommit(project.dirPath, commitMessage, files);
          updateExecutionState({
            sourceBranch,
            commitHash,
            currentStep: 'source-push',
            completedTargets: [],
            remainingTargets: resumeTargets,
            targetPushBranches: [...targetPushBranches],
            sourcePushEnabled: sourcePushSelected,
            sourcePushed,
          });
        }

        if (!sourcePushed && sourcePushSelected) {
          await gitPush(project.dirPath);
          sourcePushed = true;
        }

        const completedTargets: string[] = resumedState ? [...resumedState.completedTargets] : [];
        let remainingTargets = [...resumeTargets];

        for (const targetBranch of resumeTargets) {
          const stash = await gitStashPush(
            project.dirPath,
            true,
            `clawchestra-branch-sync:${project.id}:${targetBranch}`,
          );
          let checkoutTargetSucceeded = false;
          let restoreStash = stash.stashed;
          try {
            updateExecutionState({
              sourceBranch,
              commitHash,
              currentStep: 'target-cherry-pick',
              currentTarget: targetBranch,
              completedTargets,
              remainingTargets,
              targetPushBranches: [...targetPushBranches],
              sourcePushEnabled: sourcePushSelected,
              sourcePushed,
            });

            await gitCheckoutBranch(project.dirPath, targetBranch);
            checkoutTargetSucceeded = true;

            const cherryPick = await gitCherryPickCommit(project.dirPath, commitHash);
            if (cherryPick.status === 'applied') {
              let targetPushed = false;
              const targetState = (branchStatesByProject.get(project.id) ?? []).find((b) => b.name === targetBranch);
              if (targetState?.hasUpstream && targetPushBranches.has(targetBranch)) {
                await gitPush(project.dirPath);
                targetPushed = true;
              }
              perBranchResults.push({
                branch: targetBranch,
                status: 'success',
                hash: commitHash,
                pushed: targetPushed,
              });
              completedTargets.push(targetBranch);
              remainingTargets = remainingTargets.filter((value) => value !== targetBranch);
              updateExecutionState({
                sourceBranch,
                commitHash,
                currentStep: 'target-complete',
                completedTargets,
                remainingTargets,
                targetPushBranches: [...targetPushBranches],
                sourcePushEnabled: sourcePushSelected,
                sourcePushed,
              });
            } else if (cherryPick.status === 'conflict') {
              // Auto-abort: capture metadata, then clean up git state
              const conflictInfo = {
                files: cherryPick.conflictingFiles,
                message: cherryPick.message,
              };
              await gitAbortCherryPick(project.dirPath).catch(() => undefined);

              const conflict: ConflictContext = {
                sourceBranch,
                targetBranch,
                commitHash,
                files: conflictInfo.files,
                details: conflictInfo.message,
              };
              perBranchResults.push({
                branch: targetBranch,
                status: 'conflict',
                hash: commitHash,
                reason: conflictInfo.message,
              });
              updateExecutionState({
                sourceBranch,
                commitHash,
                currentStep: 'conflict',
                currentTarget: targetBranch,
                completedTargets,
                remainingTargets,
                targetPushBranches: [...targetPushBranches],
                sourcePushEnabled: sourcePushSelected,
                sourcePushed,
                pendingStashRef: stash.stashed ? stash.stashRef : undefined,
                errorMessage: conflictInfo.message,
                conflictFiles: conflictInfo.files,
              });
              // Cherry-pick aborted above — finally blocks will restore source branch + stash
              return {
                projectId: project.id,
                success: false,
                hash: commitHash,
                pushed: sourcePushed,
                branchResults: perBranchResults,
                conflict,
                error: `Cherry-pick to ${targetBranch} had conflicts — aborted automatically`,
              };
            } else {
              await gitAbortCherryPick(project.dirPath).catch(() => undefined);
              perBranchResults.push({
                branch: targetBranch,
                status: 'failed',
                hash: commitHash,
                reason: cherryPick.message,
              });
              updateExecutionState({
                sourceBranch,
                commitHash,
                currentStep: 'failed',
                currentTarget: targetBranch,
                completedTargets,
                remainingTargets,
                targetPushBranches: [...targetPushBranches],
                sourcePushEnabled: sourcePushSelected,
                sourcePushed,
                errorMessage: cherryPick.message,
              });
              return {
                projectId: project.id,
                success: false,
                hash: commitHash,
                pushed: sourcePushed,
                branchResults: perBranchResults,
                error: cherryPick.message || `Cherry-pick failed on ${targetBranch}`,
              };
            }
          } finally {
            if (checkoutTargetSucceeded) {
              await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
            }
            if (restoreStash && stash.stashed) {
              await gitPopStash(project.dirPath, stash.stashRef ?? null);
            }
          }
        }

        clearPersistedState();
        return {
          projectId: project.id,
          success: true,
          hash: commitHash,
          pushed: sourcePushed,
          branchResults: perBranchResults,
        };
      } catch (error) {
        return {
          projectId: project.id,
          success: false,
          hash: commitHash,
          pushed: sourcePushed,
          branchResults: perBranchResults,
          error: String(error),
        };
      } finally {
        await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
        if (branchSyncLockToken) {
          await gitSyncLockRelease(project.dirPath, branchSyncLockToken).catch(() => undefined);
        }
      }
    },
    [
      branchStatesByProject,
      commitMessage,
      pullFirstEnabled,
      pushEnabled,
      selectedCategories,
      targetBranches,
      targetPushEnabled,
    ],
  );

  const updateConflictDraftContent = useCallback(
    (projectId: string, path: string, content: string) => {
      setConflictDraftsByProject((prev) => {
        const next = new Map(prev);
        const drafts = (next.get(projectId) ?? []).map((draft) => (
          draft.path === path ? { ...draft, proposedContent: content } : draft
        ));
        next.set(projectId, drafts);
        return next;
      });
    },
    [],
  );

  const generateConflictDrafts = useCallback(
    async (project: DirtyProject, conflict: ConflictContext) => {
      setLoadingConflictDraftIds((prev) => new Set(prev).add(project.id));

      // Phase 1: Re-create conflict to capture fresh context, then clean up.
      // Git is clean after Phase 1 completes (auto-abort was already applied).
      let capturedContext: Awaited<ReturnType<typeof gitGetConflictContext>> = [];
      let lockToken: string | null = null;
      let checkedOutTarget = false;

      const execution = executionStateByProject.get(project.id);
      const sourceBranch = execution?.sourceBranch ?? conflict.sourceBranch;

      try {
        lockToken = await gitSyncLockAcquire(project.dirPath);
        const stash = await gitStashPush(project.dirPath, true, `clawchestra-conflict-resolve:${project.id}`);

        try {
          await gitCheckoutBranch(project.dirPath, conflict.targetBranch);
          checkedOutTarget = true;

          const cherryPick = await gitCherryPickCommit(project.dirPath, conflict.commitHash);
          if (cherryPick.status === 'applied') {
            // Conflict resolved externally — treat as success
            clearExecutionState(project.id);
            setExecutionStateByProject((prev) => { const next = new Map(prev); next.delete(project.id); return next; });
            return;
          }
          if (cherryPick.status === 'conflict') {
            capturedContext = await gitGetConflictContext(project.dirPath);
          }
          // Abort cherry-pick regardless — return to clean state
          await gitAbortCherryPick(project.dirPath).catch(() => undefined);
          checkedOutTarget = false;
        } finally {
          // Always restore: checkout source + pop stash
          if (checkedOutTarget) {
            await gitAbortCherryPick(project.dirPath).catch(() => undefined);
          }
          await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
          if (stash.stashed) {
            await gitPopStash(project.dirPath, stash.stashRef ?? null).catch(() => undefined);
          }
        }
      } catch (error) {
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(project.id);
          if (!existing) return prev;
          next.set(project.id, { ...existing, error: `Failed to re-create conflict context: ${String(error)}` });
          return next;
        });
        return;
      } finally {
        if (lockToken) {
          await gitSyncLockRelease(project.dirPath, lockToken).catch(() => undefined);
        }
      }

      // Phase 2: Git is clean. Send captured context to OpenClaw for AI proposal.
      if (capturedContext.length === 0) {
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(project.id);
          if (!existing) return prev;
          next.set(project.id, { ...existing, error: 'Conflict detected but no files could be extracted for AI resolution.' });
          return next;
        });
        return;
      }

      try {
        const prompt = [
          'You are resolving git cherry-pick conflicts.',
          'Return only strict JSON with this shape:',
          '{"files":[{"path":"string","strategy":"string","summary":"string","resolvedContent":"string"}]}',
          '',
          'Rules:',
          '1. Preserve non-conflicting content from both versions.',
          '2. Never delete roadmap/spec/plan items without reason.',
          '3. Prefer deterministic merges over stylistic rewrites.',
          '',
          `Source branch: ${conflict.sourceBranch}`,
          `Target branch: ${conflict.targetBranch}`,
          `Commit: ${conflict.commitHash}`,
          '',
          'Conflict payload:',
          JSON.stringify(
            capturedContext.map((file) => ({
              path: file.path,
              ours: truncateForPrompt(file.oursContent),
              theirs: truncateForPrompt(file.theirsContent),
              current: truncateForPrompt(file.currentContent),
            })),
            null,
            2,
          ),
        ].join('\n');

        const raw = await sendOpenClawMessage({
          message: prompt,
          attachments: [],
        });

        const parsed = JSON.parse(stripCodeFence(raw)) as {
          files?: Array<{
            path?: string;
            strategy?: string;
            summary?: string;
            resolvedContent?: string;
          }>;
        };

        const mappedDrafts = capturedContext.map((contextFile) => {
          const matched = (parsed.files ?? []).find((candidate) => candidate.path === contextFile.path);
          return {
            path: contextFile.path,
            strategy: matched?.strategy?.trim() || 'manual-review',
            summary: matched?.summary?.trim() || 'No AI summary returned; review manually.',
            proposedContent: matched?.resolvedContent ?? contextFile.currentContent,
            currentContent: contextFile.currentContent,
          } as ConflictResolutionDraft;
        });

        setConflictDraftsByProject((prev) => new Map(prev).set(project.id, mappedDrafts));
      } catch (error) {
        // AI failed — provide fallback drafts from captured context
        const fallbackDrafts: ConflictResolutionDraft[] = capturedContext.map((contextFile) => ({
          path: contextFile.path,
          strategy: 'fallback-ours',
          summary: 'AI proposal unavailable; defaulted to source/ours version.',
          proposedContent: contextFile.oursContent || contextFile.currentContent,
          currentContent: contextFile.currentContent,
        }));
        if (fallbackDrafts.length > 0) {
          setConflictDraftsByProject((prev) => new Map(prev).set(project.id, fallbackDrafts));
        }
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(project.id);
          if (!existing) return prev;
          next.set(project.id, { ...existing, error: `AI proposal generation failed: ${String(error)}` });
          return next;
        });
      } finally {
        setLoadingConflictDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });
      }
    },
    [executionStateByProject],
  );

  const applyConflictDrafts = useCallback(
    async (project: DirtyProject, conflict: ConflictContext) => {
      if (syncLockRef.current) return;
      syncLockRef.current = true;
      setApplyingConflictId(project.id);

      let shouldContinue = false;
      let priorBranchResults: BranchExecutionResult[] = [];
      let resolvedBranchResult: BranchExecutionResult | null = null;
      let branchSyncLockToken: string | null = null;

      try {
        const drafts = conflictDraftsByProject.get(project.id) ?? [];
        if (drafts.length === 0) {
          throw new Error('No conflict proposal available. Generate a proposal first.');
        }

        const execution = executionStateByProject.get(project.id);
        if (!execution?.commitHash || !execution.currentTarget) {
          throw new Error('Missing execution context for conflict resolution.');
        }

        branchSyncLockToken = await gitSyncLockAcquire(project.dirPath);

        // Re-create conflict state: stash → checkout target → cherry-pick
        const stash = await gitStashPush(project.dirPath, true, `clawchestra-conflict-apply:${project.id}`);
        let checkedOutTarget = false;

        try {
          await gitCheckoutBranch(project.dirPath, execution.currentTarget);
          checkedOutTarget = true;

          const cherryPick = await gitCherryPickCommit(project.dirPath, execution.commitHash);
          if (cherryPick.status === 'applied') {
            // Conflict resolved externally — treat as success on this target
            checkedOutTarget = false; // Will checkout source in finally

            let targetPushed = false;
            if ((execution.targetPushBranches ?? []).includes(execution.currentTarget)) {
              const targetStatus = await getGitStatus(project.dirPath);
              if (targetStatus.remote) {
                await gitPush(project.dirPath);
                targetPushed = true;
              }
            }

            const completedTargets = [...execution.completedTargets, execution.currentTarget];
            const remainingTargets = execution.remainingTargets.filter((target) => target !== execution.currentTarget);

            priorBranchResults = (results.get(project.id)?.branchResults ?? []).filter(
              (item) => item.branch !== execution.currentTarget,
            );
            resolvedBranchResult = {
              branch: execution.currentTarget,
              status: 'success',
              hash: execution.commitHash,
              pushed: targetPushed,
            };

            if (remainingTargets.length === 0) {
              clearExecutionState(project.id);
              setExecutionStateByProject((prev) => { const next = new Map(prev); next.delete(project.id); return next; });
              setResults((prev) => new Map(prev).set(project.id, {
                projectId: project.id, success: true, hash: execution.commitHash,
                pushed: execution.sourcePushed, branchResults: [...priorBranchResults, resolvedBranchResult!],
              }));
            } else {
              const nextExecution: BranchSyncExecutionState = {
                ...execution, completedTargets, remainingTargets,
                currentTarget: undefined, currentStep: 'resume-after-conflict',
                pendingStashRef: undefined, updatedAt: Date.now(),
              };
              writeExecutionState(project.id, nextExecution);
              setExecutionStateByProject((prev) => new Map(prev).set(project.id, nextExecution));
              setResults((prev) => { const next = new Map(prev); next.delete(project.id); return next; });
              shouldContinue = true;
            }
            setConflictDraftsByProject((prev) => { const next = new Map(prev); next.delete(project.id); return next; });
            return;
          }

          if (cherryPick.status !== 'conflict') {
            throw new Error(cherryPick.message || `Cherry-pick failed on ${execution.currentTarget}`);
          }

          // Now mid-cherry-pick with conflicts — apply stored resolutions
          const applyResult = await gitApplyConflictResolution(
            project.dirPath,
            drafts.map((draft) => ({ path: draft.path, content: draft.proposedContent })),
          );

          if (applyResult.status !== 'applied') {
            // Resolution didn't fully apply — abort and surface error
            await gitAbortCherryPick(project.dirPath).catch(() => undefined);
            checkedOutTarget = false;
            setResults((prev) => {
              const next = new Map(prev);
              const existing = next.get(project.id);
              if (!existing) return prev;
              next.set(project.id, {
                ...existing,
                error: applyResult.message || 'Conflict apply failed',
                conflict: {
                  ...conflict,
                  files: applyResult.conflictingFiles.length > 0 ? applyResult.conflictingFiles : conflict.files,
                  details: applyResult.message || conflict.details,
                },
              });
              return next;
            });
            return;
          }

          // Cherry-pick continued successfully — push if enabled
          checkedOutTarget = false; // Will checkout source in finally
          let targetPushed = false;
          if ((execution.targetPushBranches ?? []).includes(execution.currentTarget)) {
            const targetStatus = await getGitStatus(project.dirPath);
            if (targetStatus.remote) {
              await gitPush(project.dirPath);
              targetPushed = true;
            }
          }

          const completedTargets = [...execution.completedTargets, execution.currentTarget];
          const remainingTargets = execution.remainingTargets.filter((target) => target !== execution.currentTarget);

          priorBranchResults = (results.get(project.id)?.branchResults ?? []).filter(
            (item) => item.branch !== execution.currentTarget,
          );
          const appliedBranchResult: BranchExecutionResult = {
            branch: execution.currentTarget,
            status: 'success',
            hash: execution.commitHash,
            pushed: targetPushed,
          };
          resolvedBranchResult = appliedBranchResult;

          if (remainingTargets.length === 0) {
            clearExecutionState(project.id);
            setExecutionStateByProject((prev) => {
              const next = new Map(prev);
              next.delete(project.id);
              return next;
            });
            setResults((prev) => new Map(prev).set(project.id, {
              projectId: project.id,
              success: true,
              hash: execution.commitHash,
              pushed: execution.sourcePushed,
              branchResults: [...priorBranchResults, appliedBranchResult],
            }));
          } else {
            const nextExecution: BranchSyncExecutionState = {
              ...execution,
              completedTargets,
              remainingTargets,
              currentTarget: undefined,
              currentStep: 'resume-after-conflict',
              pendingStashRef: undefined,
              updatedAt: Date.now(),
            };
            writeExecutionState(project.id, nextExecution);
            setExecutionStateByProject((prev) => new Map(prev).set(project.id, nextExecution));
            setResults((prev) => {
              const next = new Map(prev);
              next.delete(project.id);
              return next;
            });
            shouldContinue = true;
          }

          setConflictDraftsByProject((prev) => {
            const next = new Map(prev);
            next.delete(project.id);
            return next;
          });
        } finally {
          // Always clean up: abort any in-flight cherry-pick, restore source, pop stash
          if (checkedOutTarget) {
            await gitAbortCherryPick(project.dirPath).catch(() => undefined);
          }
          await gitCheckoutBranch(project.dirPath, execution.sourceBranch).catch(() => undefined);
          if (stash.stashed) {
            await gitPopStash(project.dirPath, stash.stashRef ?? null).catch(() => undefined);
          }
          if (branchSyncLockToken) {
            await gitSyncLockRelease(project.dirPath, branchSyncLockToken).catch(() => undefined);
          }
        }
      } catch (error) {
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(project.id);
          next.set(project.id, {
            projectId: project.id,
            success: false,
            hash: existing?.hash,
            pushed: existing?.pushed,
            branchResults: existing?.branchResults,
            conflict,
            error: String(error),
          });
          return next;
        });
      } finally {
        setApplyingConflictId(null);
        syncLockRef.current = false;
      }

      if (shouldContinue) {
        setSyncingId(project.id);
        try {
          const continued = await syncProject(project);
          const mergedBranchResults = [
            ...priorBranchResults,
            ...(resolvedBranchResult ? [resolvedBranchResult] : []),
            ...(continued.branchResults ?? []),
          ];
          setResults((prev) => new Map(prev).set(project.id, {
            ...continued,
            branchResults: mergedBranchResults,
          }));
        } finally {
          setSyncingId(null);
          await refreshBranchStatesForProject(project);
        }
      } else {
        await refreshBranchStatesForProject(project);
      }
    },
    [conflictDraftsByProject, executionStateByProject, refreshBranchStatesForProject, results, syncProject],
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
        await refreshBranchStatesForProject(project);
      } finally {
        syncLockRef.current = false;
      }
    },
    [refreshBranchStatesForProject, syncProject],
  );

  // Batch sync all selected
  const handleSyncAll = useCallback(async () => {
    if (syncLockRef.current) return;
    syncLockRef.current = true;
    setBatchSyncing(true);
    try {
      const toSync = syncProjects.filter(
        (p) =>
          (
            isProjectSelected(p.id)
            || Boolean(
              executionStateByProject.get(p.id)?.commitHash
              && executionStateByProject.get(p.id)?.remainingTargets.length
              && executionStateByProject.get(p.id)?.currentStep !== 'conflict',
            )
          )
          && !results.has(p.id),
      );
      for (const project of toSync) {
        setSyncingId(project.id);
        const result = await syncProject(project);
        setResults((prev) => new Map(prev).set(project.id, result));
        await refreshBranchStatesForProject(project);
      }
      setSyncingId(null);
      setBatchSyncing(false);
    } finally {
      syncLockRef.current = false;
    }
  }, [
    syncProjects,
    executionStateByProject,
    isProjectSelected,
    refreshBranchStatesForProject,
    results,
    syncProject,
  ]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // If any syncs happened, refresh projects
    if (results.size > 0) {
      onSyncComplete();
    }
  }, [onOpenChange, onSyncComplete, results.size]);

  // Lock body scroll when dialog is open to prevent double scrollbar
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <ModalDragZone />
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-200 bg-neutral-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-700">
          <div>
            <h2 className="text-lg font-semibold">Sync Changes</h2>
            <p className="text-sm text-neutral-500">
              {syncProjects.length} project{syncProjects.length !== 1 ? 's' : ''} to sync
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Project list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-3">
            {syncProjects.map((project) => {
              const git = project.gitStatus;
              const branch = getBranchIndicator(git);
              const result = results.get(project.id);
              const isSyncing = syncingId === project.id;
              const cats = getProjectDirtyCategories(git);
              const branchStates = branchStatesByProject.get(project.id) ?? [];
              const branchTargets = branchStates.filter((state) => !state.isCurrent);
              const selectedTargets = targetBranches.get(project.id) ?? new Set<string>();
              const selectedTargetPush = targetPushEnabled.get(project.id) ?? new Set<string>();
              const executionState = executionStateByProject.get(project.id);
              const canResume = Boolean(
                executionState?.commitHash
                && executionState.remainingTargets.length > 0
                && executionState.currentStep !== 'conflict',
              );
              const persistedConflict: ConflictContext | null =
                executionState?.currentStep === 'conflict' && executionState.currentTarget
                  ? {
                      sourceBranch: executionState.sourceBranch,
                      targetBranch: executionState.currentTarget,
                      commitHash: executionState.commitHash ?? '',
                      files: executionState.conflictFiles ?? [],
                      details: executionState.errorMessage ?? '',
                    }
                  : null;
              const unresolvedOtherTargets = executionState
                ? executionState.remainingTargets.filter((t) => t !== executionState.currentTarget)
                : [];
              const conflictDrafts = conflictDraftsByProject.get(project.id) ?? [];
              const loadingConflictDraft = loadingConflictDraftIds.has(project.id);
              const applyingConflict = applyingConflictId === project.id;
              const projSelected = selectedCategories.get(project.id) ?? new Set<DirtyFileCategory>();
              const hasAnySelected = projSelected.size > 0;
              const canSyncProject = hasAnySelected || canResume;
              const codeSelected = projSelected.has('code');

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
                  {/* Top row: name, branch, action */}
                  <div className="flex items-center gap-2">
                    {result?.success && <Check className="h-4 w-4 shrink-0 text-emerald-500" strokeLinejoin="miter" strokeLinecap="square" />}
                    {result && !result.success && <X className="h-4 w-4 shrink-0 text-red-500" />}

                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {project.frontmatter.icon ? `${project.frontmatter.icon} ` : ''}
                        {project.title}
                      </span>
                      {(() => {
                        const ghRepo = parseGitHubRepo(git.remote);
                        return ghRepo ? (
                          <span className="block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                            {ghRepo}
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {/* Branch picker dropdown */}
                    <BranchPicker
                      git={git}
                      branch={branch}
                      branchTargets={branchTargets}
                      selectedTargets={selectedTargets}
                      selectedTargetPush={selectedTargetPush}
                      pushEnabled={pushEnabled.has(project.id)}
                      pullFirstEnabled={pullFirstEnabled.has(project.id)}
                      hasAnySelected={hasAnySelected}
                      projectId={project.id}
                      togglePush={togglePush}
                      togglePullFirst={togglePullFirst}
                      toggleTargetBranch={toggleTargetBranch}
                      toggleTargetPush={toggleTargetPush}
                      disabled={isSyncing || batchSyncing}
                    />

                    {/* Action button — visible with selected categories or resumable state */}
                    {!result && canSyncProject && (
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
                        ) : canResume ? (
                          <RefreshCw className="mr-1 h-3 w-3" />
                        ) : (
                          <GitCommitHorizontal className="mr-1 h-3 w-3" />
                        )}
                        {canResume
                          ? 'Resume Sync'
                          : pushEnabled.has(project.id) && git.remote
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

                  {result?.branchResults && result.branchResults.length > 0 && (
                    <div className="mt-1.5 space-y-0.5 text-xs">
                      {result.branchResults.map((branchResult) => (
                        <div
                          key={`${project.id}-${branchResult.branch}`}
                          className={cn(
                            branchResult.status === 'success' && 'text-emerald-600 dark:text-emerald-400',
                            branchResult.status === 'conflict' && 'text-amber-600 dark:text-amber-400',
                            branchResult.status === 'failed' && 'text-red-600 dark:text-red-400',
                            branchResult.status === 'skipped' && 'text-neutral-500 dark:text-neutral-400',
                          )}
                        >
                          {branchResult.branch}: {branchResult.status}
                          {branchResult.pushed ? ' (pushed)' : ''}
                          {branchResult.reason ? ` — ${branchResult.reason}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Category toggles with collapsible file lists */}
                  {!result && (
                    <div className="mt-1.5 space-y-1 text-xs">
                      {(['metadata', 'documents', 'code'] as const).map((category) => {
                        const files = cats[category];
                        if (files.length === 0) return null;
                        const checked = projSelected.has(category);
                        return (
                          <CategoryFiles
                            key={category}
                            category={category}
                            files={files}
                            checked={checked}
                            disabled={isSyncing || batchSyncing}
                            onToggle={() => toggleCategory(project.id, category)}
                          />
                        );
                      })}

                      {executionState && isFailedSyncStep(executionState.currentStep) && (
                        <div className={`rounded border px-2 py-1.5 ${
                          executionState.currentStep === 'conflict'
                            ? 'border-amber-300/70 bg-amber-50/60 text-amber-700 dark:border-amber-700/80 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-red-300/70 bg-red-50/60 text-red-700 dark:border-red-700/80 dark:bg-red-950/30 dark:text-red-300'
                        }`}>
                          <div className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium">
                                {persistedConflict
                                  ? <>Cherry-pick conflict: <span className="font-semibold">{executionState.sourceBranch}</span> → <span className="font-semibold">{executionState.currentTarget}</span></>
                                  : <>Sync to <span className="font-semibold">{executionState.currentTarget ?? 'unknown branch'}</span> failed</>}
                              </div>
                              {persistedConflict && persistedConflict.files.length > 0 && (
                                <div className="mt-0.5">
                                  {persistedConflict.files.length === 1
                                    ? persistedConflict.files[0]
                                    : `${persistedConflict.files.length} files`} need{persistedConflict.files.length === 1 ? 's' : ''} resolution
                                </div>
                              )}
                              {unresolvedOtherTargets.length > 0 && (
                                <div className="mt-0.5 text-neutral-600 dark:text-neutral-400">
                                  Also pending: {unresolvedOtherTargets.join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {persistedConflict && (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 font-medium text-revival-accent-400 hover:underline"
                                  onClick={() => {
                                    setResults((prev) => new Map(prev).set(project.id, {
                                      projectId: project.id,
                                      success: false,
                                      hash: executionState.commitHash,
                                      conflict: persistedConflict,
                                      error: `Conflict while cherry-picking to ${executionState.currentTarget}`,
                                    }));
                                    void generateConflictDrafts(project, persistedConflict);
                                  }}
                                  disabled={isSyncing || batchSyncing || loadingConflictDraft}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Resolve with AI
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-neutral-300 hover:underline"
                                  onClick={() => onRequestChatPrefill(buildConflictPrefill(project, persistedConflict))}
                                >
                                  <HelpCircle className="h-3 w-3" />
                                  Open in chat
                                </button>
                              </>
                            )}
                            {!persistedConflict && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 font-medium text-revival-accent-400 hover:underline"
                                onClick={() => onRequestChatPrefill(buildHelpMessage(project))}
                              >
                                <HelpCircle className="h-3 w-3" />
                                Ask agent to help
                              </button>
                            )}
                            {canResume && (
                              <button
                                type="button"
                                className="text-revival-accent-400 hover:underline"
                                onClick={() => handleSyncOne(project)}
                                disabled={isSyncing || batchSyncing}
                              >
                                Resume
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-neutral-500 hover:underline"
                              onClick={() => {
                                clearExecutionState(project.id);
                                setExecutionStateByProject((prev) => {
                                  const next = new Map(prev);
                                  next.delete(project.id);
                                  return next;
                                });
                              }}
                              disabled={isSyncing || batchSyncing}
                            >
                              Dismiss
                            </button>
                          </div>
                          {executionState.errorMessage && (
                            <GitErrorDetails raw={executionState.errorMessage} className="mt-1" />
                          )}
                        </div>
                      )}

                      {/* Code risk indicator */}
                      {codeSelected && cats.code.length > 0 && (
                        <div className="ml-5 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Code changes included — review before committing</span>
                        </div>
                      )}

                    </div>
                  )}

                  {/* Warning + help for unsafe branches */}
                  {!branch.safe && !result && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      <span className="text-amber-600 dark:text-amber-400">
                        Branch is {(git.behindCount ?? 0) > 0 && (git.aheadCount ?? 0) > 0 ? 'diverged' : 'behind remote'}
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
                    <div className="mt-1.5 space-y-1 text-xs">
                      {result.conflict ? (
                        <>
                          <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>
                              Conflict in <span className="font-medium">{result.conflict.targetBranch}</span>
                              {' '}— {result.conflict.files.length === 1
                                ? result.conflict.files[0]
                                : `${result.conflict.files.length} files`} need{result.conflict.files.length === 1 ? 's' : ''} resolution
                            </span>
                          </div>
                          <div className="ml-[18px] flex flex-wrap items-center gap-x-3 gap-y-1">
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 font-medium text-revival-accent-400 hover:underline"
                              onClick={() => {
                                void generateConflictDrafts(project, result.conflict as ConflictContext);
                              }}
                              disabled={loadingConflictDraft || applyingConflict}
                            >
                              {loadingConflictDraft ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {loadingConflictDraft ? 'Generating...' : 'Resolve with AI'}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-neutral-300 hover:underline"
                              onClick={() => {
                                onRequestChatPrefill(buildConflictPrefill(project, result.conflict as ConflictContext));
                              }}
                            >
                              <HelpCircle className="h-3 w-3" />
                              Open in chat
                            </button>
                          </div>
                          <GitErrorDetails raw={result.error ?? ''} className="ml-[18px]" />
                          {conflictDrafts.length > 0 && (
                            <div className="mt-2 space-y-2 rounded border border-neutral-300/80 bg-neutral-100/70 p-2 dark:border-neutral-700 dark:bg-neutral-800/60">
                              <div className="text-neutral-600 dark:text-neutral-300">
                                AI proposed a fix — review or edit before applying
                              </div>
                              {conflictDrafts.map((draft) => {
                                const strategyLabel =
                                  draft.strategy === 'fallback-ours' ? 'Kept your version (AI was unavailable)'
                                    : draft.strategy === 'ai-merge' ? 'AI merged both versions'
                                    : draft.strategy === 'manual-review' ? 'AI proposed a change — review carefully'
                                    : `AI strategy: ${draft.strategy}`;
                                return (
                                  <div key={draft.path} className="space-y-1 rounded border border-neutral-300/70 bg-neutral-0/80 p-2 dark:border-neutral-700 dark:bg-neutral-900/60">
                                    <div className="font-medium text-neutral-700 dark:text-neutral-200">{draft.path}</div>
                                    <div className="text-neutral-500 dark:text-neutral-400">
                                      {strategyLabel}{draft.summary ? ` — ${draft.summary}` : ''}
                                    </div>
                                    <textarea
                                      value={draft.proposedContent}
                                      onChange={(event) => {
                                        updateConflictDraftContent(project.id, draft.path, event.target.value);
                                      }}
                                      disabled={applyingConflict}
                                      className="min-h-[120px] w-full rounded border border-neutral-300 bg-neutral-0 px-2 py-1 font-mono text-[11px] text-neutral-900 focus:border-revival-accent-400 focus:outline-none focus:ring-1 focus:ring-revival-accent-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                    />
                                  </div>
                                );
                              })}
                              <div className="inline-flex items-center gap-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={applyingConflict}
                                  onClick={() => {
                                    void applyConflictDrafts(project, result.conflict as ConflictContext);
                                  }}
                                >
                                  {applyingConflict ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="mr-1.5 h-4 w-4" strokeLinejoin="miter" strokeLinecap="square" />
                                  )}
                                  Apply &amp; continue sync
                                </Button>
                                <button
                                  type="button"
                                  className="text-neutral-500 hover:underline"
                                  disabled={applyingConflict}
                                  onClick={() => {
                                    setConflictDraftsByProject((prev) => {
                                      const next = new Map(prev);
                                      next.delete(project.id);
                                      return next;
                                    });
                                  }}
                                >
                                  Discard proposal
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                            <X className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>Sync failed</span>
                          </div>
                          <div className="ml-[18px] flex items-center gap-3">
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 font-medium text-revival-accent-400 hover:underline"
                              onClick={() => onRequestChatPrefill(buildHelpMessage(project))}
                            >
                              <HelpCircle className="h-3 w-3" />
                              Ask agent to help
                            </button>
                          </div>
                          <GitErrorDetails raw={result.error ?? ''} className="ml-[18px]" />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Commit message + actions */}
        <div className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-700">
          {dirtyProjects.some((p) => !results.has(p.id)) && (
            <>
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
            </>
          )}

          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>
              {results.size > 0 ? 'Done' : 'Cancel'}
            </Button>

            {selectedCount > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={batchSyncing || (selectedCommitCount > 0 && !commitMessage.trim())}
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

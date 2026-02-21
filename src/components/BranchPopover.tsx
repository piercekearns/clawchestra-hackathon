import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GitBranchState, ProjectViewModel } from '../lib/schema';
import { gitCheckoutBranch, gitGetBranchStates } from '../lib/tauri';
import { getTargetBranchIndicator } from '../lib/git-sync-utils';
import { GitHubStatusBadge } from './GitHubStatusBadge';

interface BranchPopoverProps {
  project: ProjectViewModel;
  badgeClassName: string;
  badgeTooltip: ReactNode;
  badgeLabel: string;
  onCheckoutComplete: () => void;
}

export function BranchPopover({
  project,
  badgeClassName,
  badgeTooltip,
  badgeLabel,
  onCheckoutComplete,
}: BranchPopoverProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Fetch branches on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBranches([]);

    gitGetBranchStates(project.dirPath)
      .then((result) => {
        if (cancelled) return;
        setBranches(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, project.dirPath]);

  // Position popover
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: Math.min(rect.bottom + 4, window.innerHeight - 320),
      right: Math.max(window.innerWidth - rect.right, 8),
    });
  }, [open]);

  // Click-outside + Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target)
        && popoverRef.current && !popoverRef.current.contains(target)
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

  // Default branch heuristic
  const defaultBranch = useMemo(
    () => branches.find((b) => b.name === 'main')?.name
      ?? branches.find((b) => b.name === 'master')?.name
      ?? null,
    [branches],
  );

  // Sort: current → default → alphabetical
  const sorted = useMemo(
    () => [...branches].sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      if (defaultBranch && a.name === defaultBranch) return -1;
      if (defaultBranch && b.name === defaultBranch) return 1;
      return a.name.localeCompare(b.name);
    }),
    [branches, defaultBranch],
  );

  const handleCheckout = useCallback(async (branchName: string) => {
    setCheckingOut(branchName);
    try {
      await gitCheckoutBranch(project.dirPath, branchName);
      setOpen(false);
      onCheckoutComplete();
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingOut(null);
    }
  }, [project.dirPath, onCheckoutComplete]);

  return (
    <div ref={triggerRef} className="relative shrink-0">
      <GitHubStatusBadge
        className={badgeClassName}
        tooltip={badgeTooltip}
        label={badgeLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      />

      {open && pos && (
        <div
          ref={popoverRef}
          className="fixed z-[100] min-w-[13rem] max-h-[300px] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style={{ top: pos.top, right: pos.right }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {loading && (
            <div className="flex items-center justify-center px-3 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
            </div>
          )}

          {error && !loading && (
            <div className="px-3 py-2 text-xs text-red-500">{error}</div>
          )}

          {!loading && !error && sorted.length <= 1 && (
            <div className="px-3 py-2 text-xs text-neutral-500">No other local branches</div>
          )}

          {!loading && !error && sorted.length > 1 && sorted.map((branch) => {
            const indicator = getTargetBranchIndicator(branch);
            const isCurrent = branch.isCurrent;
            const isDefault = branch.name === defaultBranch;
            const isCheckingThis = checkingOut === branch.name;

            return (
              <div key={branch.name} className="px-3 py-1">
                {isCurrent ? (
                  <div className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-neutral-500" />
                    <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                      {branch.name}
                    </span>
                    {isDefault && (
                      <span className="text-[10px] text-neutral-400">(default)</span>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-0 py-0.5 text-left text-xs text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 disabled:opacity-50"
                    disabled={checkingOut != null}
                    onClick={() => void handleCheckout(branch.name)}
                  >
                    {isCheckingThis ? (
                      <Loader2 className="h-3 w-3 animate-spin text-neutral-400" />
                    ) : (
                      <span className="h-3 w-3" />
                    )}
                    <span>{branch.name}</span>
                    {isDefault && (
                      <span className="text-[10px] text-neutral-400">(default)</span>
                    )}
                    {branch.localOnly && (
                      <span className="text-[10px] text-neutral-400">(local)</span>
                    )}
                    {!branch.localOnly && !indicator.safe && (
                      <span className="text-[10px] text-amber-500">{indicator.label.replace(branch.name, '').trim()}</span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

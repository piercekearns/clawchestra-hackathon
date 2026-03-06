import { useState, useRef, useEffect } from 'react';
import { AlertCircle, XCircle, X, Copy, MessageSquare } from 'lucide-react';
import { useDashboardStore } from '../lib/store';

interface FlattenedWarning {
  projectId: string;
  rejection: { timestamp: number; rejected_fields: string[]; reason: string };
}

interface BuildError {
  message: string;
  timestamp: number;
}

export function StatusBadge() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const validationRejections = useDashboardStore((s) => s.validationRejections);
  const setChatDraft = useDashboardStore((s) => s.setChatDraft);
  const dismissValidationRejection = useDashboardStore((s) => s.dismissValidationRejection);
  const storeBuildErrors = useDashboardStore((s) => s.buildErrors);
  const dismissBuildError = useDashboardStore((s) => s.dismissBuildError);

  // Flatten all projects' unresolved rejections
  const warnings: FlattenedWarning[] = [];
  for (const [projectId, rejections] of Object.entries(validationRejections)) {
    for (const r of rejections) {
      if (!r.resolved) {
        warnings.push({ projectId, rejection: r });
      }
    }
  }

  const buildErrors = storeBuildErrors;

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (warnings.length === 0 && buildErrors.length === 0) return null;

  const hasErrors = buildErrors.length > 0;
  const totalCount = warnings.length + buildErrors.length;

  const severityClasses = hasErrors
    ? 'bg-status-danger/15 text-status-danger'
    : 'bg-status-warning/15 text-status-warning';

  const hoverClasses = hasErrors
    ? 'hover:bg-status-danger/25'
    : 'hover:bg-status-warning/25';

  const Icon = hasErrors ? XCircle : AlertCircle;

  const formatTimestamp = (ts: number) => new Date(ts).toLocaleString();

  const formatFields = (fields: string[]) => {
    if (fields.length === 1 && fields[0] === '*') return 'Full import — all fields';
    return fields.join(', ');
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const allItemsText = [
    ...warnings.map((w) => `Validation warning: ${w.rejection.reason}`),
    ...buildErrors.map((e) => `Build error: ${e.message}`),
  ].join('\n\n');

  const allIssuesDraft = [
    ...warnings.map((w) => `- Validation warning: ${w.rejection.reason}`),
    ...buildErrors.map((e) => `- Build error: ${e.message}`),
  ].join('\n');

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        title={`${totalCount} issue${totalCount > 1 ? 's' : ''}`}
        className={`flex items-center rounded-full px-1.5 py-0.5 ${severityClasses} ${hoverClasses}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Icon className="h-3.5 w-3.5" />
        {totalCount > 1 && (
          <span className="ml-0.5 text-[10px] font-semibold">{totalCount}</span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
              Status
            </span>
            <button
              type="button"
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Items */}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {/* Validation warnings */}
            {warnings.map((w) => (
              <div
                key={`${w.projectId}-${w.rejection.timestamp}`}
                className="rounded-md border border-neutral-100 p-2 dark:border-neutral-700"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-status-warning">
                    Validation warning
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {formatTimestamp(w.rejection.timestamp)}
                  </span>
                </div>
                <p className="mb-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {formatFields(w.rejection.rejected_fields)}
                </p>
                <p className="select-text text-xs text-neutral-600 dark:text-neutral-300">
                  {w.rejection.reason}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() =>
                      copyToClipboard(`Validation warning: ${w.rejection.reason}`)
                    }
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() => {
                      setChatDraft(
                        `I'm seeing this issue: ${w.rejection.reason}. Can you help?`,
                      );
                      setOpen(false);
                    }}
                  >
                    <MessageSquare className="h-3 w-3" /> Ask OpenClaw
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() =>
                      dismissValidationRejection(w.projectId, w.rejection.timestamp)
                    }
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}

            {/* Build errors */}
            {buildErrors.map((e) => (
              <div
                key={e.timestamp}
                className="rounded-md border border-neutral-100 p-2 dark:border-neutral-700"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-status-danger">
                    Build error
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {formatTimestamp(e.timestamp)}
                  </span>
                </div>
                <p className="select-text text-xs text-neutral-600 dark:text-neutral-300">
                  {e.message}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() => copyToClipboard(`Build error: ${e.message}`)}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() => {
                      setChatDraft(
                        `I'm seeing this issue: ${e.message}. Can you help?`,
                      );
                      setOpen(false);
                    }}
                  >
                    <MessageSquare className="h-3 w-3" /> Ask OpenClaw
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    onClick={() => dismissBuildError(e.timestamp)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-700">
            <div className="flex gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                onClick={() => copyToClipboard(allItemsText)}
              >
                <Copy className="h-3 w-3" /> Copy all
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                onClick={() => {
                  setChatDraft(
                    `I'm seeing these issues:\n${allIssuesDraft}\n\nCan you help?`,
                  );
                  setOpen(false);
                }}
              >
                <MessageSquare className="h-3 w-3" /> Ask OpenClaw (all)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

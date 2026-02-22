import { useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { ValidationRejection } from '../lib/tauri';

interface ValidationBadgeProps {
  rejections: ValidationRejection[];
  onDismiss: (timestamp: number) => void;
}

export function ValidationBadge({ rejections, onDismiss }: ValidationBadgeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const unresolved = rejections.filter((r) => !r.resolved);
  if (unresolved.length === 0) return null;

  const last = unresolved[unresolved.length - 1];

  const formatFields = (fields: string[]) => {
    if (fields.length === 1 && fields[0] === '*') return 'Full import — all fields';
    return fields.join(', ');
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        title={`${unresolved.length} rejected write${unresolved.length > 1 ? 's' : ''}`}
        className="flex items-center rounded-full bg-status-warning/15 px-1.5 py-0.5 text-status-warning hover:bg-status-warning/25"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        {unresolved.length > 1 && (
          <span className="ml-0.5 text-[10px] font-semibold">{unresolved.length}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between">
            <span className="text-xs font-medium text-status-warning">
              Agent write partially rejected
            </span>
            <button
              type="button"
              className="ml-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            <p>
              <span className="font-medium">Fields:</span> {formatFields(last.rejected_fields)}
            </p>
            <p>
              <span className="font-medium">Reason:</span> {last.reason}
            </p>
            <p className="text-neutral-400">
              {new Date(last.timestamp).toLocaleString()}
            </p>
          </div>

          <button
            type="button"
            className="mt-2 text-xs text-revival-accent-500 hover:text-revival-accent-600 dark:text-revival-accent-400"
            onClick={() => {
              onDismiss(last.timestamp);
              if (unresolved.length <= 1) setOpen(false);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

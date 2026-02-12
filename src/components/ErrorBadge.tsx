import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardError } from '../lib/errors';
import { Badge } from './ui/badge';

interface ErrorBadgeProps {
  errors: DashboardError[];
}

function formatError(error: DashboardError): string {
  if (error.type === 'gateway_down') return error.message;
  if (error.type === 'parse_failure') return `${error.file}: ${error.error}`;
  if (error.type === 'save_failure') return `${error.file}: ${error.error}`;
  if (error.type === 'file_not_found') return error.file;
  return `${error.localPath}/${error.statusFile}`;
}

export function ErrorBadge({ errors }: ErrorBadgeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => {
    return errors.reduce<Record<string, number>>((acc, error) => {
      acc[error.type] = (acc[error.type] ?? 0) + 1;
      return acc;
    }, {});
  }, [errors]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (errors.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        <Badge variant="warning" className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold">
        <AlertTriangle className="h-4 w-4" />
        {errors.length} warning{errors.length === 1 ? '' : 's'}
        </Badge>
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[22rem] rounded-xl border border-neutral-200 bg-neutral-0 p-3 text-xs shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-2 border-b border-neutral-200 pb-2 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
            {Object.entries(grouped).map(([key, count]) => (
              <div key={key} className="flex justify-between py-0.5">
                <span>{key}</span>
                <span>{count}</span>
              </div>
            ))}
          </div>
          <ul className="max-h-56 space-y-1 overflow-auto pr-1 text-neutral-600 dark:text-neutral-300">
            {errors.map((error, index) => (
              <li key={`${error.type}-${index}`} className="rounded-md bg-neutral-50 px-2 py-1 dark:bg-neutral-800">
                {formatError(error)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

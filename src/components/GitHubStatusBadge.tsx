import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitHubMark } from './icons/GitHubMark';

interface GitHubStatusBadgeProps {
  className: string;
  tooltip: string;
  label: string;
}

export function GitHubStatusBadge({ className, tooltip, label }: GitHubStatusBadgeProps) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        ref={iconRef}
        className="inline-flex"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GitHubMark className={`h-3.5 w-3.5 ${className}`} />
      </span>
      {pos
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap rounded-md border border-neutral-600 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

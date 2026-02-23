import type { ReactNode } from 'react';
import { GitHubMark } from './icons/GitHubMark';
import { Tooltip } from './Tooltip';

interface GitHubStatusBadgeProps {
  className: string;
  tooltip: ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function GitHubStatusBadge({ className, tooltip, label, onClick }: GitHubStatusBadgeProps) {
  const Wrapper = onClick ? 'button' : 'span';

  return (
    <Tooltip text={tooltip}>
      <Wrapper
        className={`inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-200${onClick ? ' cursor-pointer transition-shadow hover:ring-2 hover:ring-current/20' : ''}`}
        tabIndex={0}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GitHubMark className={`h-3.5 w-3.5 ${className}`} />
        <span className="truncate max-w-[9rem]">{label}</span>
      </Wrapper>
    </Tooltip>
  );
}

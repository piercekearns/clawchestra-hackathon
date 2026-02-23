import type { ReactNode } from 'react';
import { GitHubMark } from './icons/GitHubMark';

interface GitHubStatusBadgeProps {
  className: string;
  tooltip: ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function GitHubStatusBadge({ className, tooltip, label, onClick }: GitHubStatusBadgeProps) {
  const Wrapper = onClick ? 'button' : 'span';

  return (
    <Wrapper
      className={`inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[10px] text-neutral-600 transition-colors dark:text-neutral-400${onClick ? ' cursor-pointer hover:border-neutral-200 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100' : ''}`}
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
  );
}

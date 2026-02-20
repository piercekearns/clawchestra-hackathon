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
        className={`inline-flex${onClick ? ' cursor-pointer rounded-full transition-shadow hover:ring-2 hover:ring-current/20' : ''}`}
        tabIndex={0}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GitHubMark className={`h-3.5 w-3.5 ${className}`} />
      </Wrapper>
    </Tooltip>
  );
}

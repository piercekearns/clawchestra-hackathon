import { GitHubMark } from './icons/GitHubMark';
import { Tooltip } from './Tooltip';

interface GitHubStatusBadgeProps {
  className: string;
  tooltip: string;
  label: string;
}

export function GitHubStatusBadge({ className, tooltip, label }: GitHubStatusBadgeProps) {
  return (
    <Tooltip text={tooltip}>
      <span
        className="inline-flex"
        tabIndex={0}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GitHubMark className={`h-3.5 w-3.5 ${className}`} />
      </span>
    </Tooltip>
  );
}

import { Circle, Loader2 } from 'lucide-react';
import type { ChatConnectionState } from './types';

interface StatusBadgeProps {
  state: ChatConnectionState;
  labelOverride?: string | null;
  title?: string;
  usagePercent?: number | null;
}

const STATE_CONFIG: Record<ChatConnectionState, { label: string; colorClass: string; animate?: boolean }> = {
  connected: {
    label: 'Connected',
    colorClass: 'fill-revival-accent-400 text-revival-accent-400',
  },
  connecting: {
    label: 'Connecting',
    colorClass: 'fill-amber-400 text-amber-400',
    animate: true,
  },
  reconnecting: {
    label: 'Reconnecting',
    colorClass: 'fill-amber-400 text-amber-400',
    animate: true,
  },
  error: {
    label: 'Error',
    colorClass: 'fill-status-danger text-status-danger',
  },
  disconnected: {
    label: 'Disconnected',
    colorClass: 'fill-neutral-400 text-neutral-400 dark:fill-neutral-500 dark:text-neutral-500',
  },
};

export function StatusBadge({ state, labelOverride, title, usagePercent }: StatusBadgeProps) {
  const config = STATE_CONFIG[state];
  const label = labelOverride ?? config.label;
  const showUsage = typeof usagePercent === 'number' && usagePercent > 0;
  const clampedUsage = showUsage ? Math.min(100, Math.max(0, usagePercent)) : 0;
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const dash = (clampedUsage / 100) * circumference;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-300"
      title={title}
    >
      <span className="relative flex h-3 w-3 items-center justify-center">
        {showUsage ? (
          <svg className="absolute inset-0" viewBox="0 0 12 12" aria-hidden>
            <circle
              cx="6"
              cy="6"
              r={radius}
              className="stroke-neutral-300/70 dark:stroke-neutral-600/70"
              strokeWidth="1.5"
              fill="none"
            />
            <circle
              cx="6"
              cy="6"
              r={radius}
              className="stroke-revival-accent-400"
              strokeWidth="1.5"
              fill="none"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="round"
              transform="rotate(-90 6 6)"
            />
          </svg>
        ) : null}
        {config.animate ? (
          <Loader2 className={`h-2.5 w-2.5 animate-spin ${config.colorClass}`} />
        ) : (
          <Circle className={`h-2.5 w-2.5 ${config.colorClass}`} />
        )}
      </span>
      {label}
    </span>
  );
}

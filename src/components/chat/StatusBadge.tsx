import { Circle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import type { ChatConnectionState } from './types';

interface StatusBadgeProps {
  state: ChatConnectionState;
  labelOverride?: string | null;
  usagePercent?: number | null;
  usageTooltip?: ReactNode | null;
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

export function StatusBadge({
  state,
  labelOverride,
  usagePercent,
  usageTooltip,
}: StatusBadgeProps) {
  const config = STATE_CONFIG[state];
  const label = labelOverride ?? config.label;
  const showUsage = typeof usagePercent === 'number' && Number.isFinite(usagePercent);
  const clampedUsage = showUsage ? Math.min(100, Math.max(0, usagePercent)) : 0;
  const radius = 4;
  const circumference = 2 * Math.PI * radius;
  const dash = (clampedUsage / 100) * circumference;

  const ring = (
    <span className="relative flex h-2.5 w-2.5 items-center justify-center text-revival-accent-400">
      <svg className="absolute inset-0" viewBox="0 0 10 10" aria-hidden>
        <circle
          cx="5"
          cy="5"
          r={radius}
          className="stroke-neutral-300/70 dark:stroke-neutral-600/70"
          strokeWidth="1.5"
          fill="none"
        />
        {showUsage ? (
          <circle
            cx="5"
            cy="5"
            r={radius}
            className="stroke-revival-accent-400"
            strokeWidth="1.5"
            fill="none"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
            transform="rotate(-90 5 5)"
          />
        ) : null}
      </svg>
    </span>
  );

  return (
    <span className="inline-flex h-4 items-center gap-1.5 whitespace-nowrap rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] leading-none text-neutral-700 dark:border-neutral-600 dark:text-neutral-300 overflow-hidden">
      <span className="relative flex h-3 w-3 items-center justify-center">
        {config.animate ? (
          <Loader2 className={`h-2.5 w-2.5 animate-spin ${config.colorClass}`} />
        ) : (
          <Circle className={`h-2.5 w-2.5 ${config.colorClass}`} />
        )}
      </span>
      <span className="leading-none">{label}</span>
      {showUsage ? (
        usageTooltip ? (
          <Tooltip text={usageTooltip} className="inline-flex items-center self-center text-current">
            {ring}
          </Tooltip>
        ) : (
          ring
        )
      ) : null}
    </span>
  );
}

import { Circle, Loader2 } from 'lucide-react';
import type { ChatConnectionState } from './types';

interface StatusBadgeProps {
  state: ChatConnectionState;
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

export function StatusBadge({ state }: StatusBadgeProps) {
  const config = STATE_CONFIG[state];

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-300">
      {config.animate ? (
        <Loader2 className={`h-2.5 w-2.5 animate-spin ${config.colorClass}`} />
      ) : (
        <Circle className={`h-2.5 w-2.5 ${config.colorClass}`} />
      )}
      {config.label}
    </span>
  );
}

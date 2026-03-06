import { Circle, Loader2 } from 'lucide-react';
import { type ReactNode, useCallback, useRef, useState, useEffect } from 'react';
import { Tooltip } from '../Tooltip';
import { useDashboardStore } from '../../lib/store';
import type { ChatConnectionState } from './types';

interface StatusBadgeProps {
  state: ChatConnectionState;
  labelOverride?: string | null;
  usagePercent?: number | null;
  usageTooltip?: ReactNode | null;
  onResetModel?: (() => void) | null;
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
  onResetModel,
}: StatusBadgeProps) {
  const errorReason = useDashboardStore((s) => s.wsConnectionErrorReason);
  const config = STATE_CONFIG[state];
  const label = labelOverride ?? (state === 'error' && errorReason ? 'Pairing Required' : config.label);
  const showUsage = typeof usagePercent === 'number' && Number.isFinite(usagePercent);
  const clampedUsage = showUsage ? Math.min(100, Math.max(0, usagePercent)) : 0;
  const radius = 4;
  const circumference = 2 * Math.PI * radius;
  const dash = (clampedUsage / 100) * circumference;

  // Context menu for "Reset to primary model"
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!onResetModel || !labelOverride) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuPos({ x: event.clientX, y: event.clientY });
    },
    [onResetModel, labelOverride],
  );

  useEffect(() => {
    if (!menuPos) return;
    const dismiss = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuPos(null);
      }
    };
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPos(null);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', dismissKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', dismissKey);
    };
  }, [menuPos]);

  const ringSlot = (
    <span className="relative flex h-2.5 w-2.5 flex-none items-center justify-center text-revival-accent-400">
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

  const badgePaddingClass = showUsage ? 'pr-[22px]' : 'pr-2';

  const badgeContent = (
    <span
      className={`relative inline-flex flex-none items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] text-neutral-700 dark:border-neutral-600 dark:text-neutral-300 ${badgePaddingClass}`}
    >
      <span className="relative flex h-3 w-3 items-center justify-center">
        {config.animate ? (
          <Loader2 className={`h-2.5 w-2.5 animate-spin ${config.colorClass}`} />
        ) : (
          <Circle className={`h-2.5 w-2.5 ${config.colorClass}`} />
        )}
      </span>
      <span>{label}</span>
      {showUsage ? (
        usageTooltip ? (
          <Tooltip
            text={usageTooltip}
            className="absolute right-[7.5px] top-[calc(50%-0.5px)] inline-flex -translate-y-1/2 items-center"
          >
            {ringSlot}
          </Tooltip>
        ) : (
          <span className="absolute right-[7.5px] top-[calc(50%-0.5px)] -translate-y-1/2">
            {ringSlot}
          </span>
        )
      ) : null}
    </span>
  );

  const contextMenuWrapper = (content: ReactNode) => (
    <span onContextMenu={handleContextMenu} className="relative inline-flex">
      {content}
      {menuPos ? (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-md border border-neutral-300 bg-neutral-0 py-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-800"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            onClick={() => {
              setMenuPos(null);
              onResetModel?.();
            }}
          >
            Reset to primary model
          </button>
        </div>
      ) : null}
    </span>
  );

  if (state === 'error' && errorReason) {
    return contextMenuWrapper(
      <Tooltip text={errorReason}>
        {badgeContent}
      </Tooltip>,
    );
  }

  return contextMenuWrapper(badgeContent);
}

import { CheckCircle2, HelpCircle, Info, Layers, Loader2, XCircle } from 'lucide-react';
import type { SystemBubbleKind, SystemBubbleMeta } from '../../lib/gateway';
import { cn } from '../../lib/utils';

const ICONS: Record<SystemBubbleKind, typeof CheckCircle2> = {
  completion: CheckCircle2,
  failure: XCircle,
  compaction: Layers,
  decision: HelpCircle,
  info: Info,
};

const COLORS: Record<SystemBubbleKind, string> = {
  completion: 'text-green-500 dark:text-green-400',
  failure: 'text-red-500 dark:text-red-400',
  compaction: 'text-neutral-400 dark:text-neutral-500',
  decision: 'text-blue-500 dark:text-blue-400',
  info: 'text-neutral-500 dark:text-neutral-400',
};

const BORDER_COLORS: Record<SystemBubbleKind, string> = {
  completion: 'border-green-500/20 dark:border-green-400/20',
  failure: 'border-red-500/20 dark:border-red-400/20',
  compaction: 'border-neutral-300/50 dark:border-neutral-700/50',
  decision: 'border-blue-500/20 dark:border-blue-400/20',
  info: 'border-neutral-300/50 dark:border-neutral-700/50',
};

interface SystemBubbleProps {
  meta: SystemBubbleMeta;
  content: string;
  timestamp?: number;
}

export function SystemBubble({ meta, content, timestamp }: SystemBubbleProps) {
  const Icon = ICONS[meta.kind];
  const iconColor = COLORS[meta.kind];
  const borderColor = BORDER_COLORS[meta.kind];
  const ariaRole = meta.kind === 'failure' ? 'alert' : 'status';

  return (
    <div className="flex justify-center px-4 py-2" role={ariaRole}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          'bg-neutral-50/50 dark:bg-neutral-900/50',
          borderColor,
        )}
      >
        <div className="flex items-center gap-2">
          {meta.loading ? (
            <Loader2 className={cn('h-4 w-4 flex-shrink-0 animate-spin', iconColor)} aria-hidden="true" />
          ) : (
            <Icon className={cn('h-4 w-4 flex-shrink-0', iconColor)} aria-hidden="true" />
          )}
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{meta.title}</span>
        </div>

        {meta.details && Object.keys(meta.details).length > 0 && (
          <dl className="mt-1.5 space-y-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
            {Object.entries(meta.details).map(([key, value]) => (
              <div key={key} className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 font-medium">{key}:</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {content ? (
          <p className="mt-1 pl-6 text-xs text-neutral-500 dark:text-neutral-400 break-words">
            {content}
          </p>
        ) : null}

        {meta.actions && meta.actions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
            {meta.actions.map((action) => (
              <span key={action} className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {action}
              </span>
            ))}
          </div>
        )}

        {timestamp ? (
          <div className="mt-1 pl-6 text-[11px] text-neutral-400 dark:text-neutral-500">
            {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

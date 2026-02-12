import { FileText, ClipboardList } from 'lucide-react';
import { cn } from '../../lib/utils';

type DocType = 'spec' | 'plan';

interface DocBadgeProps {
  type: DocType;
  onClick?: () => void;
}

const CONFIG: Record<DocType, { icon: typeof FileText; label: string }> = {
  spec: { icon: FileText, label: 'spec' },
  plan: { icon: ClipboardList, label: 'plan' },
};

export function DocBadge({ type, onClick }: DocBadgeProps) {
  const { icon: Icon, label } = CONFIG[type];

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
        'border-neutral-300 text-neutral-600 hover:border-revival-accent-400 hover:text-neutral-800',
        'dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-revival-accent-400 dark:hover:text-neutral-200',
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

import { Plus } from 'lucide-react';

interface QuickAddCardProps {
  label: string;
  onClick: () => void;
}

export function QuickAddCard({ label, onClick }: QuickAddCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-500 transition-colors hover:border-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-700 dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/40 dark:hover:text-neutral-200"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

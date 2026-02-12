import { Bot, X } from 'lucide-react';

interface ResponseToastProps {
  message: string;
  onOpen: () => void;
  onDismiss: () => void;
}

export function ResponseToast({ message, onOpen, onDismiss }: ResponseToastProps) {
  return (
    <div className="mb-2 w-full rounded-lg border border-neutral-300/80 bg-neutral-0/95 shadow-lg backdrop-blur dark:border-neutral-600 dark:bg-neutral-900/95">
      <div className="flex items-center gap-2 px-3 py-2">
        <Bot className="h-4 w-4 shrink-0 text-revival-accent-400" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs text-neutral-700 hover:text-neutral-900 dark:text-neutral-200 dark:hover:text-neutral-100"
          onClick={onOpen}
          title="Open chat drawer"
        >
          {message}
        </button>
        <button
          type="button"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          onClick={onDismiss}
          aria-label="Dismiss response"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

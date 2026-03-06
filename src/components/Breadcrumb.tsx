import type { ViewContext } from '../lib/views';

interface BreadcrumbProps {
  viewContext: ViewContext;
  onNavigate?: (crumbId: string, index: number) => void;
}

export function Breadcrumb({ viewContext, onNavigate }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
      {viewContext.breadcrumbs.map((crumb, index) => {
        const isLast = index === viewContext.breadcrumbs.length - 1;
        return (
          <div key={crumb.id} className="flex items-center gap-2">
            {index > 0 ? <span className="text-neutral-300 dark:text-neutral-600">/</span> : null}
            {isLast ? (
              <span className="text-neutral-900 dark:text-neutral-100">{crumb.label}</span>
            ) : (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                onClick={() => onNavigate?.(crumb.id, index)}
              >
                {crumb.label}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}

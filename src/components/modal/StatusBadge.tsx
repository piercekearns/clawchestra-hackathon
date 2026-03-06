import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '../ui/badge';
import type { BadgeProps } from '../ui/badge';
import { cn } from '../../lib/utils';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

interface StatusBadgeProps<T extends string> {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  variant?: (status: T) => BadgeVariant;
  onChange: (next: T) => void;
}

export function StatusBadge<T extends string>({
  value,
  options,
  labels,
  variant,
  onChange,
}: StatusBadgeProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [open]);

  const displayLabel = (status: T) => labels?.[status] ?? status;
  const currentVariant = variant?.(value) ?? 'default';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        className="group flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400 rounded-full"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <Badge
          variant={currentVariant}
          className="cursor-pointer select-none pr-1.5 transition-opacity group-hover:opacity-80"
        >
          {displayLabel(value)}
          <ChevronDown className={cn(
            'ml-0.5 h-3 w-3 transition-transform',
            open && 'rotate-180',
          )} />
        </Badge>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] rounded-lg border border-neutral-200 bg-neutral-0 py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {options.map((option) => {
            const optionVariant = variant?.(option) ?? 'default';
            const isActive = option === value;

            return (
              <button
                key={option}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  isActive && 'font-medium',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(option);
                  setOpen(false);
                }}
              >
                <Badge variant={optionVariant} className="text-[10px]">
                  {displayLabel(option)}
                </Badge>
                {isActive && <span className="text-xs text-neutral-400">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

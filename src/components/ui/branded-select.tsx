import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type BrandedSelectOption = {
  value: string;
  label: string;
};

interface BrandedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: BrandedSelectOption[];
  disabled?: boolean;
}

export function BrandedSelect({
  value,
  onChange,
  options,
  disabled,
}: BrandedSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-10 w-full items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-800 transition-colors hover:border-neutral-400 focus-visible:border-revival-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400/40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-4 w-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-200 bg-neutral-0 p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${isSelected ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectOption(option.value);
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

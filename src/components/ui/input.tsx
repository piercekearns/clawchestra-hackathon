import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-revival-accent-400/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:placeholder:text-neutral-400',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

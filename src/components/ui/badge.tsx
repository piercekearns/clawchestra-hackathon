import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
        accent: 'border-transparent bg-revival-accent-400 text-neutral-900',
        warning: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
        danger: 'border-status-danger/40 bg-status-danger/10 text-status-danger',
        success: 'border-status-active/40 bg-status-active/10 text-status-active',
        outline: 'border-neutral-300 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

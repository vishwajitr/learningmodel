import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium [&_svg]:size-3 whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/15 text-violet-300',
      secondary: 'border-border bg-secondary text-secondary-foreground',
      outline: 'border-border text-muted-foreground',
      success: 'border-transparent bg-emerald-500/15 text-emerald-300',
      warning: 'border-transparent bg-amber-500/15 text-amber-300',
      danger: 'border-transparent bg-red-500/15 text-red-300',
      info: 'border-transparent bg-blue-500/15 text-blue-300',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

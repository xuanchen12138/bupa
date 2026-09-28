import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const variants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-strong',
        outline: 'border border-border-strong bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        soft: 'bg-primary-soft text-primary-strong hover:bg-primary/15',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        destructiveGhost: 'text-destructive hover:bg-destructive-soft',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-9 rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      type={asChild ? undefined : 'button'}
      className={cn(variants({ variant, size }), className)}
      {...props}
    />
  );
}

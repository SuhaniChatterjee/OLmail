import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-field hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active && 'bg-field text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

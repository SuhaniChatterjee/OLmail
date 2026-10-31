import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Filled grey field used on the login screen. */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-lg bg-field px-4 text-sm text-ink placeholder:text-muted outline-none',
        'focus:ring-2 focus:ring-brand/40',
        className,
      )}
      {...props}
    />
  );
}

/** Small bordered numeric box used for delay / hourly limit. */
export function NumberBox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      min={0}
      className={cn(
        'h-8 w-[58px] rounded-md border border-line px-2 text-sm text-ink placeholder:text-muted/70 outline-none',
        'focus:border-brand [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
        className,
      )}
      {...props}
    />
  );
}

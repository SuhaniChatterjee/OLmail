import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'orange' | 'gray' | 'red' | 'blue' | 'green';

const TONES: Record<Tone, string> = {
  orange: 'bg-[#fde8d7] text-[#c2410c] border-[#fbd2b3]',
  gray: 'bg-field text-[#555] border-line',
  red: 'bg-red-50 text-red-600 border-red-200',
  blue: 'bg-blue-50 text-blue-600 border-blue-200',
  green: 'bg-brand-soft text-brand-dark border-[#c7ead4]',
};

export function Badge({ tone = 'gray', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

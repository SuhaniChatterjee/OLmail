import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

const COLORS = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];

function colorFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (src) {
    return <img src={src} alt={name} referrerPolicy="no-referrer" style={style} className={cn('shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span style={style} className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', colorFor(name), className)}>
      {initials(name)}
    </span>
  );
}

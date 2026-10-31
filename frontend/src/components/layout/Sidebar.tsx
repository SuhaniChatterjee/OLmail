import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/cn';
import type { EmailStats } from '../../types/api';
import { Button } from '../ui/Button';
import { ClockIcon, SendIcon } from '../ui/icons';
import { IntegrationsPanel } from './IntegrationsPanel';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

const NAV = [
  { to: '/scheduled', label: 'Scheduled', icon: ClockIcon, key: 'scheduled' },
  { to: '/sent', label: 'Sent', icon: SendIcon, key: 'sent' },
] as const;

export function Sidebar({ stats }: { stats: EmailStats | null }) {
  const navigate = useNavigate();
  return (
    <aside className="flex w-[232px] shrink-0 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div className="px-2 pb-2">
        <Logo />
      </div>
      <UserMenu />
      <Button variant="outline" fullWidth onClick={() => navigate('/compose')} className="h-[30px]">
        Compose
      </Button>

      <nav className="mt-4">
        <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted">Core</p>
        <ul className="space-y-1">
          {NAV.map(({ to, label, icon: Icon, key }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink hover:bg-field')
                }
              >
                <Icon size={17} />
                <span className="flex-1">{label}</span>
                <span className="text-xs font-normal text-muted">{stats ? stats[key] : ''}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <IntegrationsPanel />
    </aside>
  );
}

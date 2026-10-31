import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { ChevronDownIcon, LogoutIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl bg-field px-3 py-2.5 text-left hover:bg-[#ededec]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.name} src={user.avatarUrl} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{user.name}</span>
          <span className="block truncate text-[11px] text-muted">{user.email}</span>
        </span>
        <ChevronDownIcon size={16} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-0 right-0">
        <button
          role="menuitem"
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          <LogoutIcon size={16} /> Log out
        </button>
      </Popover>
    </div>
  );
}

import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { EmailStatus } from '../../types/api';
import { IconButton } from '../ui/IconButton';
import { FilterIcon, RefreshIcon, SearchIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';

interface MailboxToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  statusOptions: { value: EmailStatus; label: string }[];
  status: EmailStatus | undefined;
  onStatus: (value: EmailStatus | undefined) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function MailboxToolbar({ search, onSearch, statusOptions, status, onStatus, onRefresh, refreshing }: MailboxToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const options = [{ value: undefined, label: 'All' }, ...statusOptions];

  return (
    <div className="mb-2 flex items-center gap-3">
      <label className="flex h-[34px] max-w-[565px] flex-1 items-center gap-2 rounded-full bg-field px-3.5 text-muted focus-within:ring-2 focus-within:ring-brand/30">
        <SearchIcon size={15} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search"
          className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </label>

      <div className="relative">
        <IconButton label="Filter" active={Boolean(status)} onClick={() => setFilterOpen((o) => !o)}>
          <FilterIcon size={16} />
        </IconButton>
        <Popover open={filterOpen} onClose={() => setFilterOpen(false)} className="right-0 w-40">
          <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted">Status</p>
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                onStatus(o.value);
                setFilterOpen(false);
              }}
              className={cn('block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-field', status === o.value && 'font-semibold text-brand')}
            >
              {o.label}
            </button>
          ))}
        </Popover>
      </div>

      <IconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
        <RefreshIcon size={16} className={refreshing ? 'animate-spin' : ''} />
      </IconButton>
    </div>
  );
}

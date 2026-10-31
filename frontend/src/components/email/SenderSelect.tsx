import { useState, type FormEvent } from 'react';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { Sender } from '../../types/api';
import { Button } from '../ui/Button';
import { CheckIcon, ChevronDownIcon, PlusIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';
import { Spinner } from '../ui/Spinner';

interface SenderSelectProps {
  value: string | undefined;
  onChange: (senderId: string) => void;
}

/** "From" picker. Each sender is its own Ethereal mailbox with its own hourly limit counter. */
export function SenderSelect({ value, onChange }: SenderSelectProps) {
  const toast = useToast();
  const senders = useAsync(async () => {
    const res = await api.listSenders();
    if (!value && res.items[0]) onChange(res.items[0].id);
    return res.items;
  }, []);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const selected = senders.data?.find((s) => s.id === value);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const sender = await api.createSender({ name: name.trim() });
      senders.setData((list) => [...(list ?? []), sender]);
      onChange(sender.id);
      toast.success(`Created sender ${sender.email}`);
      setName('');
      setAdding(false);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create sender');
    } finally {
      setCreating(false);
    }
  };

  const pick = (s: Sender) => {
    onChange(s.id);
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center gap-2 rounded-md bg-field px-2.5 py-1.5 text-[15px] text-ink hover:bg-[#ededec]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {senders.loading ? <Spinner size={14} /> : <span className="truncate">{selected ? `${selected.name} <${selected.email}>` : 'Select sender'}</span>}
        <ChevronDownIcon size={14} className="shrink-0 text-muted" />
      </button>
      {senders.error && <p className="mt-1 text-xs text-red-600">{senders.error}</p>}

      <Popover open={open} onClose={() => { setOpen(false); setAdding(false); }} className="left-0 w-[340px]">
        <ul role="listbox" className="max-h-60 overflow-y-auto">
          {senders.data?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={s.id === value}
                onClick={() => pick(s)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-field"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{s.name}</span>
                  <span className="block truncate text-[11px] text-muted">{s.email}</span>
                </span>
                {s.id === value && <CheckIcon size={15} className="text-brand" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line pt-1">
          {adding ? (
            <form onSubmit={create} className="flex items-center gap-2 px-2 py-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sender name"
                maxLength={100}
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-sm outline-none focus:border-brand"
              />
              <Button type="submit" size="sm" loading={creating} disabled={!name.trim()}>Add</Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand hover:bg-brand-soft')}
            >
              <PlusIcon size={15} /> New sender (Ethereal mailbox)
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}

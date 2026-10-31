import { useMemo, useState } from 'react';
import { toDateTimeLocal } from '../../lib/format';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';

interface SendLaterPopoverProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (when: Date) => void;
  submitting: boolean;
}

function presets(): { label: string; date: Date }[] {
  const now = new Date();
  const at = (daysAhead: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  return [
    { label: 'In 1 minute', date: new Date(now.getTime() + 60_000) },
    { label: 'Tomorrow, 10:00 AM', date: at(1, 10) },
    { label: 'Tomorrow, 11:00 AM', date: at(1, 11) },
    { label: 'Tomorrow, 3:00 PM', date: at(1, 15) },
  ];
}

export function SendLaterPopover({ open, onClose, onConfirm, submitting }: SendLaterPopoverProps) {
  const [custom, setCustom] = useState(() => toDateTimeLocal(new Date(Date.now() + 5 * 60_000)));
  const options = useMemo(() => (open ? presets() : []), [open]);
  const customDate = custom ? new Date(custom) : null;
  const customInvalid = !customDate || Number.isNaN(customDate.getTime()) || customDate.getTime() < Date.now() - 60_000;

  return (
    <Popover open={open} onClose={onClose} className="right-0 w-[300px] p-4">
      <h3 className="mb-3 text-[15px] font-semibold text-ink">Send Later</h3>
      <label className="mb-1 block text-xs text-muted" htmlFor="send-later-at">Pick date &amp; time</label>
      <input
        id="send-later-at"
        type="datetime-local"
        value={custom}
        min={toDateTimeLocal(new Date())}
        onChange={(e) => setCustom(e.target.value)}
        className="mb-3 h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
      />
      <ul className="mb-4 space-y-0.5 border-t border-line pt-2">
        {options.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => setCustom(toDateTimeLocal(p.date))}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-field"
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          loading={submitting}
          disabled={customInvalid}
          onClick={() => customDate && onConfirm(customDate < new Date() ? new Date() : customDate)}
        >
          Schedule
        </Button>
      </div>
    </Popover>
  );
}

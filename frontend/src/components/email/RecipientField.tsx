import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useToast } from '../../context/ToastContext';
import { dedupe, extractEmails, isValidEmail } from '../../lib/recipients';
import { UploadIcon, XIcon } from '../ui/icons';

const COLLAPSED_COUNT = 3;

interface RecipientFieldProps {
  value: string[];
  onChange: (emails: string[]) => void;
}

export function RecipientField({ value, onChange }: RecipientFieldProps) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (emails: string[]) => {
    const merged = dedupe([...value, ...emails]);
    onChange(merged);
    return merged.length - value.length;
  };

  const commitDraft = () => {
    const text = draft.trim().replace(/[,;]$/, '');
    if (!text) return;
    if (!isValidEmail(text)) {
      toast.error(`"${text}" is not a valid email address`);
      return;
    }
    add([text]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const found = extractEmails(e.clipboardData.getData('text'));
    if (found.length > 1) {
      e.preventDefault();
      const added = add(found);
      toast.success(`Added ${added} recipient${added === 1 ? '' : 's'}`);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File is too large (max 5 MB)');
      return;
    }
    const found = extractEmails(await file.text());
    if (!found.length) {
      toast.error(`No email addresses found in ${file.name}`);
    } else {
      const added = add(found);
      toast.success(`Found ${found.length} email${found.length === 1 ? '' : 's'} in ${file.name} — ${added} new`);
      setExpanded(false);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const visible = expanded ? value : value.slice(0, COLLAPSED_COUNT);
  const hidden = value.length - visible.length;

  return (
    <div className="flex items-start gap-3 border-b border-line pb-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {visible.map((email) => (
          <span key={email} className="group inline-flex items-center gap-1 rounded-full border border-brand bg-white py-0.5 pl-2.5 pr-1.5 text-[13px] text-ink">
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() => onChange(value.filter((v) => v !== email))}
              className="rounded-full p-0.5 text-muted opacity-60 hover:bg-field hover:text-ink group-hover:opacity-100"
            >
              <XIcon size={11} />
            </button>
          </span>
        ))}
        {hidden > 0 && (
          <button type="button" onClick={() => setExpanded(true)} className="rounded-full border border-brand bg-brand-soft px-2 py-0.5 text-[13px] text-ink">
            +{hidden}
          </button>
        )}
        {expanded && value.length > COLLAPSED_COUNT && (
          <button type="button" onClick={() => setExpanded(false)} className="px-1 text-xs text-muted hover:text-ink">
            Show less
          </button>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commitDraft}
          placeholder={value.length ? '' : 'Type an email and press Enter, or upload a list'}
          className="h-7 min-w-[160px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          aria-label="Add recipient"
        />
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-0.5">
        {value.length > 0 && <span className="text-xs text-muted">{value.length} recipient{value.length === 1 ? '' : 's'}</span>}
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-[15px] text-brand hover:text-brand-dark">
          <UploadIcon size={16} /> Upload List
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { formatShortDateTime, stripHtml } from '../../lib/format';
import type { Email } from '../../types/api';
import { StarButton } from './StarButton';
import { StatusBadge } from './StatusBadge';

export function EmailRow({ email, onChange }: { email: Email; onChange: (updated: Email) => void }) {
  const navigate = useNavigate();
  const open = () => navigate(`/email/${email.id}`);

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      className="group flex cursor-pointer items-center gap-4 border-b border-line px-5 py-3.5 hover:bg-[#fafafa] focus:bg-[#fafafa] focus:outline-none"
    >
      <span className="w-[220px] shrink-0 truncate text-sm text-ink" title={email.recipient}>
        To: {email.recipient}
      </span>
      <StatusBadge email={email} />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="text-ink">{email.subject}</span>
        <span className="text-muted"> - {stripHtml(email.body)}</span>
      </span>
      {(email.status === 'sent' || email.status === 'failed') && (
        <time dateTime={email.sentAt ?? email.scheduledAt} className="shrink-0 text-xs text-muted" title={email.status === 'sent' ? 'Sent at' : 'Failed (was scheduled for)'}>
          {formatShortDateTime(email.sentAt ?? email.scheduledAt)}
        </time>
      )}
      <StarButton email={email} onChange={onChange} />
    </li>
  );
}

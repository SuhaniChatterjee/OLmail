import DOMPurify from 'dompurify';
import { useNavigate, useParams } from 'react-router-dom';
import { StarButton } from '../components/email/StarButton';
import { StatusBadge } from '../components/email/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { ArrowLeftIcon, ExternalLinkIcon } from '../components/ui/icons';
import { PageLoader } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatShortDateTime, nameFromEmail } from '../lib/format';

export function EmailDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: email, error, loading, setData } = useAsync(() => api.getEmail(id), [id]);

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/scheduled'));

  if (loading && !email) return <div className="h-screen"><PageLoader /></div>;
  if (error || !email) {
    return (
      <EmptyState
        title="Email not found"
        description={error ?? undefined}
        action={<Button variant="outline" size="sm" onClick={() => navigate('/scheduled')}>Back to inbox</Button>}
      />
    );
  }

  const senderName = email.senderName ?? (user?.email === email.sender ? user.name : nameFromEmail(email.sender));
  const when = email.sentAt ?? email.scheduledAt;

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center gap-3 px-4 py-4">
        <IconButton label="Back" onClick={goBack} className="text-ink">
          <ArrowLeftIcon size={20} />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-xl text-ink">{email.subject}</h1>
        <StarButton email={email} onChange={setData} />
        {user && (
          <>
            <span className="mx-1 h-6 w-px bg-line" />
            <Avatar name={user.name} src={user.avatarUrl} size={28} />
          </>
        )}
      </header>

      <article className="mx-auto max-w-[920px] px-6 pb-16">
        <div className="flex items-start gap-4">
          <Avatar name={senderName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[15px] font-semibold text-ink">{senderName}</span>
              <span className="text-sm text-muted">&lt;{email.sender}&gt;</span>
            </div>
            <p className="text-sm text-muted">to {email.recipient}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-sm text-muted">{formatShortDateTime(when)}</span>
            <StatusBadge email={email} />
          </div>
        </div>

        {email.status === 'failed' && email.error && (
          <p className="ml-[50px] mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            Delivery failed after {email.attempts} attempt(s): {email.error}
          </p>
        )}

        <div className="rich-content ml-[50px] mt-6 space-y-4 text-[15px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.body) }} />

        {email.previewUrl && (
          <a href={email.previewUrl} target="_blank" rel="noreferrer" className="ml-[50px] mt-8 inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
            View delivered message on Ethereal <ExternalLinkIcon size={14} />
          </a>
        )}
      </article>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../components/layout/AppLayout';
import { EmailRow } from '../components/email/EmailRow';
import { MailboxToolbar } from '../components/email/MailboxToolbar';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ClockIcon, SendIcon } from '../components/ui/icons';
import { PageLoader } from '../components/ui/Spinner';
import { useAsync } from '../hooks/useAsync';
import { useDebounce } from '../hooks/useDebounce';
import { api } from '../lib/api';
import type { Email, EmailStatus, Mailbox } from '../types/api';

const MAILBOXES: Record<Mailbox, {
  statusOptions: { value: EmailStatus; label: string }[];
  empty: { title: string; description: string; icon: React.ReactNode };
}> = {
  scheduled: {
    statusOptions: [
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'sending', label: 'Sending' },
    ],
    empty: { title: 'No scheduled emails', description: 'Emails you schedule will wait here until they are sent.', icon: <ClockIcon size={26} /> },
  },
  sent: {
    statusOptions: [
      { value: 'sent', label: 'Sent' },
      { value: 'failed', label: 'Failed' },
    ],
    empty: { title: 'No sent emails yet', description: 'Once your scheduled emails go out, they will show up here.', icon: <SendIcon size={24} /> },
  },
};

export function MailboxPage({ mailbox }: { mailbox: Mailbox }) {
  const navigate = useNavigate();
  const { refreshStats } = useOutletContext<LayoutContext>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmailStatus | undefined>();
  const [page, setPage] = useState(1);
  const q = useDebounce(search.trim(), 300);

  const onSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const onStatus = (value: EmailStatus | undefined) => {
    setStatus(value);
    setPage(1);
  };

  const list = useAsync(() => api.listEmails(mailbox, { q, status, page }), [mailbox, q, status, page], 10_000);
  const config = MAILBOXES[mailbox];

  const updateEmail = (updated: Email) =>
    list.setData((d) => d && { ...d, items: d.items.map((e) => (e.id === updated.id ? updated : e)) });

  const refresh = () => {
    void list.reload();
    void refreshStats();
  };

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtering = Boolean(q || status);

  return (
    <div className="flex h-full flex-col">
      <MailboxToolbar
        search={search}
        onSearch={onSearch}
        statusOptions={config.statusOptions}
        status={status}
        onStatus={onStatus}
        onRefresh={refresh}
        refreshing={list.refreshing}
      />

      {list.loading && !data ? (
        <PageLoader />
      ) : list.error && !data ? (
        <EmptyState
          title="Couldn't load emails"
          description={list.error}
          action={<Button variant="outline" size="sm" onClick={refresh}>Try again</Button>}
        />
      ) : !data || data.items.length === 0 ? (
        filtering ? (
          <EmptyState title="No matching emails" description="Try a different search or clear the filter." />
        ) : (
          <EmptyState
            {...config.empty}
            action={<Button variant="outline" size="sm" onClick={() => navigate('/compose')}>Compose email</Button>}
          />
        )
      ) : (
        <>
          <ul className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            {data.items.map((email) => (
              <EmailRow key={email.id} email={email} onChange={updateEmail} />
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3 px-5 py-3 text-sm text-muted">
              <span>
                {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}
              </span>
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

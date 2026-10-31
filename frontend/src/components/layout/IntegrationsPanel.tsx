import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { ExternalLinkIcon, LayersIcon, SlackIcon } from '../ui/icons';
import { Spinner } from '../ui/Spinner';

/** Sidebar block: Slack connection (rate-limit alerts) and a link to the live BullMQ dashboard. */
export function IntegrationsPanel() {
  const toast = useToast();
  const slack = useAsync(() => api.slackStatus(), []);
  const appConfig = useAsync(() => api.config(), []);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'test' | null>(null);

  const run = async (action: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(action);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Slack request failed');
    } finally {
      setBusy(null);
    }
  };

  // Full-page redirect to Slack's consent screen; the backend callback sends the user back here.
  const connect = () => run('connect', async () => {
    const { url } = await api.slackConnectUrl();
    window.location.assign(url);
  });
  const disconnect = () => run('disconnect', async () => {
    await api.slackDisconnect();
    await slack.reload();
    toast.info('Slack disconnected');
  });
  const test = () => run('test', async () => {
    await api.slackTest();
    toast.success('Test message sent to Slack');
  });

  const status = slack.data;

  return (
    <div className="mt-auto space-y-2">
      <p className="px-3 text-[11px] font-medium uppercase tracking-wide text-muted">Integrations</p>

      <div className="rounded-xl border border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SlackIcon size={16} />
          <span className="flex-1 text-sm text-ink">Slack alerts</span>
          {slack.loading && <Spinner size={14} />}
        </div>
        {status && (
          <>
            <p className="mt-1 truncate text-[11px] text-muted" title={status.connected ? `${status.teamName} ${status.channel ?? ''}` : undefined}>
              {status.connected
                ? `${status.teamName}${status.channel ? ` · ${status.channel}` : ''}`
                : status.configured
                  ? 'Get notified when a sender hits its hourly limit'
                  : 'Not configured on the server'}
            </p>
            {status.connected ? (
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="soft" className="h-7 flex-1 px-2 text-xs" onClick={test} loading={busy === 'test'} disabled={busy !== null}>
                  Test
                </Button>
                <Button size="sm" variant="ghost" className="h-7 flex-1 px-2 text-xs text-red-600" onClick={disconnect} loading={busy === 'disconnect'} disabled={busy !== null}>
                  Disconnect
                </Button>
              </div>
            ) : (
              status.configured && (
                <Button size="sm" variant="outline" fullWidth className="mt-2 h-7 text-xs" onClick={connect} loading={busy === 'connect'}>
                  Connect Slack
                </Button>
              )
            )}
          </>
        )}
      </div>

      {appConfig.data && (
        <a
          href={appConfig.data.queueDashboardUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink hover:bg-field"
        >
          <LayersIcon size={16} />
          <span className="flex-1">Queue dashboard</span>
          <ExternalLinkIcon size={14} className="text-muted" />
        </a>
      )}
    </div>
  );
}

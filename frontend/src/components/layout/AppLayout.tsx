import { useEffect } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { Sidebar } from './Sidebar';

export interface LayoutContext {
  refreshStats: () => Promise<void>;
}

export function AppLayout() {
  const location = useLocation();
  const stats = useAsync(() => api.stats(), [location.pathname], 10_000);
  useSlackOAuthResult();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar stats={stats.data} />
      <main className="min-w-0 flex-1 overflow-y-auto py-4 pr-4">
        <Outlet context={{ refreshStats: stats.reload } satisfies LayoutContext} />
      </main>
    </div>
  );
}

/** The Slack OAuth callback redirects back with ?slack=connected|error; show it once, then clean the URL. */
function useSlackOAuthResult() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const result = params.get('slack');
  const message = params.get('message');

  useEffect(() => {
    if (!result) return;
    if (result === 'connected') toast.success('Slack connected. Rate-limit alerts will be posted there.');
    else toast.error(message ?? 'Slack connection failed');
    setParams((p) => {
      p.delete('slack');
      p.delete('message');
      return p;
    }, { replace: true });
  }, [result, message, toast, setParams]);
}

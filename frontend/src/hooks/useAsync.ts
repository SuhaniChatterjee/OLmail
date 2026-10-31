import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** true only for the first load (or when deps change), not for background refreshes */
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Runs `fn` whenever `deps` change, optionally re-polling every `pollMs`.
 * Stale responses from superseded calls are ignored.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const callId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (background: boolean) => {
    const id = ++callId.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== callId.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== callId.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (id === callId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run(false);
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run(true);
    }, pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, run]);

  const reload = useCallback(() => run(true), [run]);
  return { data, error, loading, refreshing, reload, setData };
}

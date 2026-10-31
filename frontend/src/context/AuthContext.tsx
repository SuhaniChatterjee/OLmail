import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, tokenStore, UNAUTHORIZED_EVENT } from '../lib/api';
import type { AuthResponse, User } from '../types/api';

interface AuthState {
  user: User | null;
  /** true while restoring a session from a stored token */
  initializing: boolean;
  completeLogin: (res: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(() => Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const completeLogin = useCallback((res: AuthResponse) => {
    tokenStore.set(res.token);
    setUser(res.user);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const restore = () =>
      api
        .me()
        .then((r) => {
          if (cancelled) return;
          setUser(r.user);
          setInitializing(false);
        })
        .catch((err) => {
          if (cancelled) return;
          // Only a 401 means the token is bad. If the API is down or restarting,
          // keep the session and retry instead of logging the user out.
          if (err instanceof ApiError && err.status === 401) {
            tokenStore.clear();
            setInitializing(false);
          } else {
            retry = setTimeout(restore, 3000);
          }
        });
    void restore();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const value = useMemo(() => ({ user, initializing, completeLogin, logout }), [user, initializing, completeLogin, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

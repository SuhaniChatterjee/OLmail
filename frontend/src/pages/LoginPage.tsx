import { useGoogleLogin } from '@react-oauth/google';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { GoogleIcon } from '../components/ui/icons';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

const GOOGLE_ENABLED = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export function LoginPage() {
  const { user, completeLogin } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/scheduled';
    return <Navigate to={from} replace />;
  }

  const onEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      completeLogin(await api.loginWithEmail(email, password));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-[418px] rounded-xl border border-line px-12 pb-11 pt-12">
        <h1 className="mb-6 text-center text-[32px] font-bold text-ink">Login</h1>

        {GOOGLE_ENABLED ? <GoogleButton /> : <GoogleButtonDisabled />}

        <div className="my-5 flex items-center gap-4 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or sign up through email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={onEmailLogin} className="space-y-2.5">
          <Input type="email" placeholder="Email ID" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" placeholder="Password" autoComplete="current-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="pt-3.5">
            <Button type="submit" size="lg" fullWidth loading={submitting} className="rounded-lg">
              Login
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const googleBtnClass = 'rounded-lg font-normal text-[15px]';

/** Rendered only when a client ID exists, because useGoogleLogin requires GoogleOAuthProvider. */
function GoogleButton() {
  const { completeLogin } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const login = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: async ({ access_token }) => {
      try {
        completeLogin(await api.loginWithGoogle(access_token));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Google login failed');
      } finally {
        setLoading(false);
      }
    },
    onError: () => {
      setLoading(false);
      toast.error('Google login was cancelled or failed');
    },
    onNonOAuthError: () => setLoading(false),
  });

  return (
    <Button variant="soft" size="lg" fullWidth loading={loading} className={googleBtnClass} onClick={() => { setLoading(true); login(); }}>
      {!loading && <GoogleIcon />} Login with Google
    </Button>
  );
}

function GoogleButtonDisabled() {
  const toast = useToast();
  return (
    <Button variant="soft" size="lg" fullWidth className={googleBtnClass} onClick={() => toast.info('Google login is not configured. Set VITE_GOOGLE_CLIENT_ID in frontend/.env.')}>
      <GoogleIcon /> Login with Google
    </Button>
  );
}

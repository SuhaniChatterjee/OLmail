import { GoogleOAuthProvider } from '@react-oauth/google';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function MaybeGoogle({ children }: { children: ReactNode }) {
  return googleClientId ? <GoogleOAuthProvider clientId={googleClientId}>{children}</GoogleOAuthProvider> : <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaybeGoogle>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </MaybeGoogle>
  </StrictMode>,
);

import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ComposePage } from './pages/ComposePage';
import { EmailDetailPage } from './pages/EmailDetailPage';
import { LoginPage } from './pages/LoginPage';
import { MailboxPage } from './pages/MailboxPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/scheduled" element={<MailboxPage key="scheduled" mailbox="scheduled" />} />
          <Route path="/sent" element={<MailboxPage key="sent" mailbox="sent" />} />
        </Route>
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/email/:id" element={<EmailDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/scheduled" replace />} />
    </Routes>
  );
}

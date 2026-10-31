export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';
export type Mailbox = 'scheduled' | 'sent';

export interface Email {
  id: string;
  campaignId: string;
  senderId: string | null;
  /** Display name of the sender identity; null for emails sent before multi-sender support. */
  senderName: string | null;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
  starred: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Set on search responses: which engine served the query. */
  searchEngine?: 'elasticsearch' | 'postgres';
}

export interface EmailStats {
  scheduled: number;
  sent: number;
}

export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenSeconds: number;
  hourlyLimit?: number;
  senderId?: string;
}

export interface ScheduleResponse {
  campaignId: string;
  count: number;
}

export interface ListQuery {
  q?: string;
  status?: EmailStatus;
  page?: number;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
}

export interface CreateSenderRequest {
  name: string;
  /** Existing Ethereal credentials; omit both to create a fresh Ethereal mailbox. */
  smtpUser?: string;
  smtpPass?: string;
}

export interface SlackStatus {
  /** false when the server has no Slack app credentials */
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channel: string | null;
  connectedAt: string | null;
}

export interface AppConfig {
  queueDashboardUrl: string;
  search: 'elasticsearch' | 'postgres';
}

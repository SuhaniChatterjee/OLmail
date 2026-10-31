import type {
  AppConfig,
  AuthResponse,
  CreateSenderRequest,
  Email,
  EmailStats,
  ListQuery,
  Mailbox,
  Paginated,
  ScheduleRequest,
  ScheduleResponse,
  Sender,
  SlackStatus,
  User,
} from '../types/api';

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'auth_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired on any 401 so the auth context can log the user out. */
export const UNAUTHORIZED_EVENT = 'api:unauthorized';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

function toQueryString(query: ListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  loginWithGoogle: (accessToken: string) => request<AuthResponse>('/auth/google', { method: 'POST', body: json({ accessToken }) }),
  loginWithEmail: (email: string, password: string) =>
    request<AuthResponse>('/auth/email', { method: 'POST', body: json({ email, password }) }),
  me: () => request<{ user: User }>('/auth/me'),

  listEmails: (mailbox: Mailbox, query: ListQuery = {}) => request<Paginated<Email>>(`/emails/${mailbox}${toQueryString(query)}`),
  getEmail: (id: string) => request<Email>(`/emails/${id}`),
  stats: () => request<EmailStats>('/emails/stats'),
  schedule: (body: ScheduleRequest) => request<ScheduleResponse>('/emails/schedule', { method: 'POST', body: json(body) }),
  setStarred: (id: string, starred: boolean) => request<Email>(`/emails/${id}/star`, { method: 'PATCH', body: json({ starred }) }),

  listSenders: () => request<{ items: Sender[] }>('/senders'),
  createSender: (body: CreateSenderRequest) => request<Sender>('/senders', { method: 'POST', body: json(body) }),

  slackStatus: () => request<SlackStatus>('/integrations/slack'),
  slackConnectUrl: () => request<{ url: string }>('/integrations/slack/connect', { method: 'POST' }),
  slackDisconnect: () => request<void>('/integrations/slack', { method: 'DELETE' }),
  slackTest: () => request<{ ok: true }>('/integrations/slack/test', { method: 'POST' }),

  config: () => request<AppConfig>('/config'),
};

import 'dotenv/config';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid numeric env ${name}=${raw}`);
  return n;
}

const port = num('PORT', 4000);
// Comma-separated list allowed (e.g. production + preview URLs); the first one is used for redirects.
const frontendUrls = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);
// RENDER_EXTERNAL_URL is set automatically on Render.
const publicApiUrl = (process.env.PUBLIC_API_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`).replace(/\/$/, '');

export const config = {
  port,
  publicApiUrl,
  frontendUrl: frontendUrls[0],
  frontendUrls,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://scheduler:scheduler@localhost:54329/scheduler',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  ethereal: {
    user: process.env.ETHEREAL_USER ?? '',
    pass: process.env.ETHEREAL_PASS ?? '',
  },
  // Mailtrap Email Testing (sandbox) over HTTPS, for hosts that block SMTP ports (e.g. Render's free plan).
  // When the token is set the worker sends through Mailtrap instead of Ethereal SMTP.
  mailtrap: {
    apiToken: process.env.MAILTRAP_API_TOKEN ?? '',
    inboxId: process.env.MAILTRAP_INBOX_ID ?? '',
  },
  elasticsearch: {
    // Empty disables indexing; search then falls back to Postgres ILIKE.
    url: process.env.ELASTICSEARCH_URL ?? '',
    index: process.env.ELASTICSEARCH_INDEX ?? 'emails',
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID ?? '',
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
    redirectUri: process.env.SLACK_REDIRECT_URI ?? `${publicApiUrl}/api/integrations/slack/callback`,
  },
  bullBoard: {
    user: process.env.BULL_BOARD_USER ?? '',
    pass: process.env.BULL_BOARD_PASS ?? '',
  },
  worker: {
    concurrency: Math.max(1, num('WORKER_CONCURRENCY', 5)),
    minDelayMs: num('MIN_DELAY_BETWEEN_EMAILS_MS', 2000),
    maxPerHour: num('MAX_EMAILS_PER_HOUR', 200),
    defaultHourlyLimitPerSender: num('DEFAULT_HOURLY_LIMIT_PER_SENDER', 50),
    // Hard ceiling per sender; a campaign's own "Hourly Limit" can only lower it.
    maxPerHourPerSender: num('MAX_EMAILS_PER_HOUR_PER_SENDER', 500),
  },
} as const;

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../lib/db.js';
import { HttpError } from '../lib/http.js';

/**
 * Slack integration via the standard OAuth v2 flow with the `incoming-webhook`
 * scope: the user picks a channel on Slack's consent screen and we store the
 * webhook URL Slack hands back. Connections live in Postgres and are read at
 * notification time, so connecting/disconnecting takes effect immediately in
 * every worker, with no restart.
 */

export const slackConfigured = () => Boolean(config.slack.clientId && config.slack.clientSecret);

interface SlackConnectionRow {
  user_id: string;
  team_id: string;
  team_name: string;
  channel: string | null;
  webhook_url: string;
  access_token: string | null;
  created_at: Date;
}

export async function getSlackStatus(userId: string) {
  const { rows } = await pool.query<SlackConnectionRow>('SELECT * FROM slack_connections WHERE user_id = $1', [userId]);
  const c = rows[0];
  return {
    configured: slackConfigured(),
    connected: Boolean(c),
    teamName: c?.team_name ?? null,
    channel: c?.channel ?? null,
    connectedAt: c?.created_at ?? null,
  };
}

/** `state` is a short-lived signed token tying the callback back to the user who started the flow (CSRF-safe). */
export function buildAuthorizeUrl(userId: string): string {
  if (!slackConfigured()) throw new HttpError(501, 'Slack is not configured on the server (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET)');
  const state = jwt.sign({ uid: userId, purpose: 'slack-oauth' }, config.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'incoming-webhook',
    redirect_uri: config.slack.redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export function userIdFromState(state: string): string {
  try {
    const payload = jwt.verify(state, config.jwtSecret) as { uid?: string; purpose?: string };
    if (payload.purpose !== 'slack-oauth' || !payload.uid) throw new Error('bad state');
    return payload.uid;
  } catch {
    throw new HttpError(400, 'Invalid or expired Slack OAuth state');
  }
}

interface OAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { channel: string; url: string };
}

export async function completeOAuth(userId: string, code: string): Promise<void> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      code,
      redirect_uri: config.slack.redirectUri,
    }),
  });
  const data = (await res.json()) as OAuthAccessResponse;
  if (!data.ok || !data.incoming_webhook || !data.team) throw new HttpError(400, `Slack OAuth failed: ${data.error ?? 'no webhook returned'}`);

  // Reconnecting replaces the previous workspace/channel.
  await pool.query(
    `INSERT INTO slack_connections (user_id, team_id, team_name, channel, webhook_url, access_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name,
       channel = EXCLUDED.channel, webhook_url = EXCLUDED.webhook_url, access_token = EXCLUDED.access_token, created_at = now()`,
    [userId, data.team.id, data.team.name, data.incoming_webhook.channel, data.incoming_webhook.url, data.access_token ?? null],
  );
}

export async function disconnectSlack(userId: string): Promise<void> {
  const { rows } = await pool.query<SlackConnectionRow>('DELETE FROM slack_connections WHERE user_id = $1 RETURNING *', [userId]);
  const token = rows[0]?.access_token;
  if (token) {
    // Best effort: also revoke the token (and with it the webhook) on Slack's side.
    await fetch('https://slack.com/api/auth.revoke', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

async function postToWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Slack webhook responded ${res.status}: ${await res.text()}`);
}

/**
 * Sends a message to the user's connected channel. Returns false when the user
 * hasn't connected Slack. Delivery errors are thrown to the caller.
 */
export async function notifyUser(userId: string, text: string, blocks?: unknown[]): Promise<boolean> {
  const { rows } = await pool.query<{ webhook_url: string }>('SELECT webhook_url FROM slack_connections WHERE user_id = $1', [userId]);
  if (!rows[0]) return false;
  await postToWebhook(rows[0].webhook_url, { text, ...(blocks ? { blocks } : {}) });
  return true;
}

export interface RateLimitAlert {
  userId: string;
  senderEmail: string;
  limit: number;
  kind: 'sender' | 'global';
  nextSendAt: Date;
}

export async function notifyRateLimitHit(a: RateLimitAlert): Promise<void> {
  const what = a.kind === 'sender' ? `Sender *${a.senderEmail}* hit its hourly limit of *${a.limit}* emails.` : `The global hourly cap was reached while sending from *${a.senderEmail}*.`;
  const text = `:warning: ${what} Remaining emails were rescheduled; next send at ${a.nextSendAt.toISOString()}.`;
  try {
    const sent = await notifyUser(a.userId, text, [
      { type: 'section', text: { type: 'mrkdwn', text: `:warning: *Hourly rate limit reached*\n${what}` } },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Queued emails were moved to the next free hour window. Next send: <!date^${Math.floor(a.nextSendAt.getTime() / 1000)}^{date_short_pretty} {time}|${a.nextSendAt.toISOString()}>` }],
      },
    ]);
    console.log(sent ? `[slack] Rate-limit alert sent for ${a.senderEmail}` : `[slack] Rate limit hit for ${a.senderEmail}; Slack not connected, skipping`);
  } catch (err) {
    console.error(`[slack] Failed to send rate-limit alert: ${err instanceof Error ? err.message : err}`);
  }
}

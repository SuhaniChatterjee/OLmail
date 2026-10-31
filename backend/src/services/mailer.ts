import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

export interface SmtpAccount {
  host: string;
  port: number;
  user: string;
  pass: string;
}

// One pooled transport per SMTP account, reused across jobs in this process.
const transporters = new Map<string, Transporter>();

function getTransporter(account: SmtpAccount): Transporter {
  const key = `${account.host}:${account.port}:${account.user}`;
  let transporter = transporters.get(key);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      pool: true,
      maxConnections: 2,
      auth: { user: account.user, pass: account.pass },
    });
    transporters.set(key, transporter);
  }
  return transporter;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  /** Stable Message-ID so a retried send is recognisable as the same message. */
  messageId: string;
}

export async function sendMail(account: SmtpAccount, mail: OutgoingEmail): Promise<{ messageId: string; previewUrl: string | null }> {
  if (config.mailtrap.apiToken) return sendViaMailtrap(mail);
  const info = await getTransporter(account).sendMail(mail);
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null };
}

/** Sends through Mailtrap's sandbox API; messages land in the Mailtrap inbox and never reach real recipients. */
async function sendViaMailtrap(mail: OutgoingEmail): Promise<{ messageId: string; previewUrl: string | null }> {
  const { apiToken, inboxId } = config.mailtrap;
  if (!inboxId) throw new Error('MAILTRAP_INBOX_ID is not set');
  const from = /^"?(.*?)"?\s*<([^>]+)>$/.exec(mail.from);
  const res = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from ? { name: from[1], email: from[2] } : { email: mail.from },
      to: [{ email: mail.to }],
      subject: mail.subject,
      html: mail.html,
      headers: { 'Message-ID': mail.messageId },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; message_ids?: string[]; errors?: string[] };
  if (!res.ok || !body.success) throw new Error(`Mailtrap ${res.status}: ${body.errors?.join('; ') ?? res.statusText}`);
  return { messageId: body.message_ids?.[0] ?? mail.messageId, previewUrl: `https://mailtrap.io/inboxes/${inboxId}/messages` };
}

export function closeTransporters(): void {
  for (const t of transporters.values()) t.close();
  transporters.clear();
}

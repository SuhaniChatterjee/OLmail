import nodemailer, { type Transporter } from 'nodemailer';

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
  const info = await getTransporter(account).sendMail(mail);
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null };
}

export function closeTransporters(): void {
  for (const t of transporters.values()) t.close();
  transporters.clear();
}

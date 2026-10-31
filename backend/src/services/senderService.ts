import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { pool } from '../lib/db.js';
import { HttpError } from '../lib/http.js';

export interface SenderRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}

/** What the API exposes: never the SMTP password. */
export const toPublicSender = (s: SenderRow) => ({ id: s.id, name: s.name, email: s.email });

const ETHEREAL = { host: 'smtp.ethereal.email', port: 587 };
const MAX_SENDERS_PER_USER = 10;

// nodemailer caches the first test account per process by default, which would
// hand every "new" sender the same mailbox. Each sender must be a distinct account.
process.env.ETHEREAL_CACHE = 'no';

async function insertSender(userId: string, name: string, user: string, pass: string): Promise<SenderRow> {
  const { rows } = await pool.query<SenderRow>(
    `INSERT INTO senders (user_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $3, $6)
     ON CONFLICT (user_id, email) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [userId, name, user, ETHEREAL.host, ETHEREAL.port, pass],
  );
  return rows[0];
}

export async function listSenders(userId: string): Promise<SenderRow[]> {
  const { rows } = await pool.query<SenderRow>('SELECT * FROM senders WHERE user_id = $1 ORDER BY created_at', [userId]);
  return rows;
}

/**
 * Creates a sender backed by a brand-new Ethereal mailbox, or by the given
 * Ethereal credentials (e.g. an account made at ethereal.email/create).
 */
export async function createSender(userId: string, name: string, creds?: { user: string; pass: string }): Promise<SenderRow> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM senders WHERE user_id = $1', [userId]);
  if (Number(rows[0].count) >= MAX_SENDERS_PER_USER) throw new HttpError(400, `At most ${MAX_SENDERS_PER_USER} senders per account`);

  if (creds) {
    // Fail early on bad credentials instead of at send time.
    const transport = nodemailer.createTransport({ ...ETHEREAL, auth: creds });
    await transport.verify().catch(() => {
      throw new HttpError(400, 'Ethereal rejected those SMTP credentials');
    });
    return insertSender(userId, name, creds.user, creds.pass);
  }
  const account = await nodemailer.createTestAccount().catch(() => {
    throw new HttpError(502, 'Could not create an Ethereal account (is ethereal.email reachable?)');
  });
  return insertSender(userId, name, account.user, account.pass);
}

/**
 * Every user has at least one sender. The first one uses ETHEREAL_USER/PASS
 * when set (so the shared inbox is stable), otherwise a fresh Ethereal account.
 */
export async function ensureDefaultSender(userId: string): Promise<SenderRow[]> {
  const existing = await listSenders(userId);
  if (existing.length) return existing;
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [userId]);
  const name = rows[0]?.name ?? 'Sender';
  const { user, pass } = config.ethereal;
  const sender = user && pass ? await insertSender(userId, name, user, pass) : await createSender(userId, name);
  return [sender];
}

export async function getSenderForUser(userId: string, senderId: string): Promise<SenderRow> {
  const { rows } = await pool.query<SenderRow>('SELECT * FROM senders WHERE id = $1 AND user_id = $2', [senderId, userId]);
  if (!rows[0]) throw new HttpError(404, 'Sender not found');
  return rows[0];
}

export async function deleteSender(userId: string, senderId: string): Promise<void> {
  const pending = await pool.query(
    `SELECT 1 FROM emails WHERE sender_id = $1 AND status IN ('scheduled', 'sending') LIMIT 1`,
    [senderId],
  );
  if (pending.rowCount) throw new HttpError(409, 'This sender still has scheduled emails');
  const res = await pool.query('DELETE FROM senders WHERE id = $1 AND user_id = $2', [senderId, userId]);
  if (!res.rowCount) throw new HttpError(404, 'Sender not found');
}

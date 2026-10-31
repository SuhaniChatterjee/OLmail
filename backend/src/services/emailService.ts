import { pool } from '../lib/db.js';
import { emailQueue, enqueueEmail } from '../lib/queue.js';
import { indexCampaign } from './searchIndex.js';

export interface ScheduleInput {
  userId: string;
  senderId: string;
  sender: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayMs: number;
  hourlyLimit: number;
}

/**
 * Creates a campaign and one row per recipient, then enqueues a delayed
 * BullMQ job per email. Email i is scheduled at startTime + i * delayMs.
 * DB rows are committed before jobs are enqueued; if enqueueing partly fails,
 * reconcileScheduledJobs() on next boot re-creates the missing jobs.
 */
export async function scheduleCampaign(input: ScheduleInput) {
  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))];
  const client = await pool.connect();
  let emails: { id: string; scheduled_at: Date }[];
  let campaignId: string;
  try {
    await client.query('BEGIN');
    const campaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, subject, body, start_time, delay_ms, hourly_limit, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.userId, input.subject, input.body, input.startTime, input.delayMs, input.hourlyLimit, recipients.length],
    );
    campaignId = campaign.rows[0].id;

    const scheduledAt = recipients.map((_, i) => new Date(input.startTime.getTime() + i * input.delayMs));
    const inserted = await client.query<{ id: string; scheduled_at: Date }>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, sender, recipient, subject, body, scheduled_at)
       SELECT $1, $2, $3, $4, r, $5, $6, s
       FROM unnest($7::text[], $8::timestamptz[]) AS t(r, s)
       RETURNING id, scheduled_at`,
      [campaignId, input.userId, input.senderId, input.sender, input.subject, input.body, recipients, scheduledAt],
    );
    emails = inserted.rows;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await emailQueue.addBulk(
    emails.map((e) => ({
      name: 'send',
      data: { emailId: e.id },
      opts: { jobId: e.id, delay: Math.max(0, e.scheduled_at.getTime() - Date.now()) },
    })),
  );
  await indexCampaign(campaignId);

  return { campaignId, count: emails.length };
}

/**
 * Safety net for restarts: every email still 'scheduled' in Postgres must have
 * a job in Redis. Adding with jobId = emailId is a no-op for jobs that exist,
 * so this only fills gaps (e.g. Redis data loss or a crash mid-enqueue).
 */
export async function reconcileScheduledJobs(): Promise<number> {
  const { rows } = await pool.query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled', 'sending')`,
  );
  let restored = 0;
  // Check in chunks so thousands of pending emails don't mean thousands of sequential round trips.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const jobs = await Promise.all(chunk.map((row) => emailQueue.getJob(row.id)));
    const missing = chunk.filter((_, j) => !jobs[j]);
    await Promise.all(missing.map((row) => enqueueEmail(row.id, row.scheduled_at)));
    restored += missing.length;
  }
  return restored;
}

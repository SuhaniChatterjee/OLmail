import { DelayedError, Worker, type Job } from 'bullmq';
import { config } from './config.js';
import { migrate, pool } from './lib/db.js';
import { EMAIL_QUEUE, type EmailJobData } from './lib/queue.js';
import { createRedis } from './lib/redis.js';
import { closeTransporters, sendMail } from './services/mailer.js';
import { HOUR_MS, HourlyRateLimiter, hourWindow, SendThrottle } from './services/rateLimiter.js';
import { indexEmail } from './services/searchIndex.js';
import { ensureDefaultSender } from './services/senderService.js';
import { notifyRateLimitHit } from './services/slack.js';

interface EmailRow {
  id: string;
  user_id: string;
  sender_id: string | null;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  hourly_limit: number;
  sender_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  user_name: string;
}

const limiter = new HourlyRateLimiter(createRedis());
const throttle = new SendThrottle(createRedis(), config.worker.minDelayMs);

async function loadEmail(emailId: string): Promise<EmailRow | undefined> {
  const { rows } = await pool.query<EmailRow>(
    `SELECT e.*, c.hourly_limit, s.name AS sender_name, s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass, u.name AS user_name
     FROM emails e
     JOIN campaigns c ON c.id = e.campaign_id
     JOIN users u ON u.id = e.user_id
     LEFT JOIN senders s ON s.id = e.sender_id
     WHERE e.id = $1`,
    [emailId],
  );
  return rows[0];
}

/** Emails created before multi-sender support have no sender_id: fall back to the user's default sender. */
async function resolveSmtp(email: EmailRow) {
  if (email.smtp_host && email.smtp_port && email.smtp_user && email.smtp_pass) {
    return { host: email.smtp_host, port: email.smtp_port, user: email.smtp_user, pass: email.smtp_pass, name: email.sender_name ?? email.user_name };
  }
  const [fallback] = await ensureDefaultSender(email.user_id);
  return { host: fallback.smtp_host, port: fallback.smtp_port, user: fallback.smtp_user, pass: fallback.smtp_pass, name: fallback.name };
}

async function processEmail(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;
  const email = await loadEmail(emailId);
  // Idempotency: a re-delivered job for an email that already went out is dropped.
  if (!email || email.status === 'sent' || email.status === 'failed') return;

  const senderKey = email.sender_id ?? email.sender;
  const senderLimit = Math.min(email.hourly_limit, config.worker.maxPerHourPerSender);
  const now = Date.now();

  // A job that was pushed out by the rate limiter already holds a slot in the
  // window it was moved to, so it must not count against that window again.
  const hasReservation = job.data.reservedWindow === hourWindow(now);
  if (!hasReservation) {
    const slot = await limiter.reserve(senderKey, senderLimit, now);
    if (slot.ok) {
      if (slot.filledLimit) void alertLimitHit(email, senderKey, senderLimit, 'sender', slot.window, new Date((slot.window + 1) * HOUR_MS));
    } else {
      // Hourly limit reached: move the job to its reserved slot in the next free
      // window instead of failing it. Slots are handed out in arrival order, so
      // the backlog keeps (roughly) its original order.
      await job.updateData({ ...job.data, reservedWindow: slot.window ?? undefined });
      await pool.query(`UPDATE emails SET scheduled_at = $2, updated_at = now() WHERE id = $1`, [emailId, new Date(slot.runAt)]);
      void indexEmail(emailId);
      await job.moveToDelayed(slot.runAt, token);
      console.log(`[worker] ${email.recipient}: ${slot.blockedBy} hourly limit hit, rescheduled to ${new Date(slot.runAt).toISOString()}`);
      void alertLimitHit(email, senderKey, senderLimit, slot.blockedBy, hourWindow(now), new Date(slot.runAt));
      throw new DelayedError();
    }
  }

  // Global min gap between sends (all workers). Waiting here, after the hourly
  // check, means rescheduled jobs never consume throttle time.
  await throttle.waitForTurn();

  // Claim the row; only one worker can move it out of 'scheduled'.
  const claimed = await pool.query(
    `UPDATE emails SET status = 'sending', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status IN ('scheduled', 'sending') RETURNING id`,
    [emailId],
  );
  if (!claimed.rowCount) return;

  try {
    const smtp = await resolveSmtp(email);
    const { messageId, previewUrl } = await sendMail(smtp, {
      from: `"${smtp.name.replace(/"/g, '')}" <${smtp.user}>`,
      to: email.recipient,
      subject: email.subject,
      html: email.body,
      messageId: `<${email.id}@olmail.local>`,
    });
    await pool.query(
      `UPDATE emails SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, error = NULL, updated_at = now()
       WHERE id = $1`,
      [emailId, messageId, previewUrl],
    );
    console.log(`[worker] Sent to ${email.recipient} from ${smtp.user}${previewUrl ? ` — ${previewUrl}` : ''}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await pool.query(`UPDATE emails SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [
      emailId,
      finalAttempt ? 'failed' : 'scheduled',
      message,
    ]);
    throw err; // let BullMQ apply the retry/backoff policy
  } finally {
    void indexEmail(emailId);
  }
}

/** One Slack alert per sender per hour window, no matter how many workers see the limit. */
async function alertLimitHit(email: EmailRow, senderKey: string, limit: number, kind: 'sender' | 'global', window: number, nextSendAt: Date) {
  try {
    if (!(await limiter.markLimitNotified(senderKey, window))) return;
    await notifyRateLimitHit({ userId: email.user_id, senderEmail: email.smtp_user ?? email.sender, limit, kind, nextSendAt });
  } catch (err) {
    console.error('[worker] rate-limit alert failed', err);
  }
}

await migrate();

const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmail, {
  connection: createRedis(),
  concurrency: config.worker.concurrency,
});

worker.on('failed', (job, err) => {
  if (job) console.error(`[worker] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
});
worker.on('error', (err) => console.error('[worker] error', err));

console.log(
  `[worker] Started — concurrency=${config.worker.concurrency}, minDelay=${config.worker.minDelayMs}ms, ` +
    `globalMaxPerHour=${config.worker.maxPerHour}, maxPerHourPerSender=${config.worker.maxPerHourPerSender}`,
);

async function shutdown() {
  console.log('[worker] Shutting down gracefully...');
  await worker.close(); // waits for in-flight jobs
  closeTransporters();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

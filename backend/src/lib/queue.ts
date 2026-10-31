import { Queue } from 'bullmq';
import { createRedis } from './redis.js';

export const EMAIL_QUEUE = 'email-send';

export interface EmailJobData {
  emailId: string;
  /** Hour window in which the rate limiter already reserved this job's send slot. */
  reservedWindow?: number;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Enqueue (or re-enqueue) the delayed job for an email. jobId = emailId makes
 * this idempotent: adding a job whose id already exists is a no-op in BullMQ.
 */
export async function enqueueEmail(emailId: string, scheduledAt: Date): Promise<void> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  await emailQueue.add('send', { emailId }, { jobId: emailId, delay });
}

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { pool } from '../lib/db.js';
import { HttpError } from '../lib/http.js';
import { scheduleCampaign } from '../services/emailService.js';
import { searchEmailIds, searchEnabled } from '../services/searchIndex.js';
import { ensureDefaultSender, getSenderForUser } from '../services/senderService.js';

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  body: z.string().min(1, 'Body is required').max(200_000),
  recipients: z.array(z.email()).min(1, 'At least one recipient is required').max(10_000),
  startTime: z.coerce.date(),
  delayBetweenSeconds: z.number().int().min(0).max(86_400).default(0),
  hourlyLimit: z.number().int().min(1).max(10_000).optional(),
  senderId: z.uuid().optional(),
});

emailsRouter.post('/schedule', async (req, res) => {
  const input = scheduleSchema.parse(req.body);
  // Small grace window for clock skew; anything in the past just sends ASAP.
  if (input.startTime.getTime() < Date.now() - 60_000) throw new HttpError(400, 'startTime is in the past');

  const sender = input.senderId
    ? await getSenderForUser(req.user!.id, input.senderId)
    : (await ensureDefaultSender(req.user!.id))[0];

  const result = await scheduleCampaign({
    userId: req.user!.id,
    senderId: sender.id,
    sender: sender.email,
    subject: input.subject,
    body: input.body,
    recipients: input.recipients,
    startTime: input.startTime,
    delayMs: input.delayBetweenSeconds * 1000,
    hourlyLimit: input.hourlyLimit ?? config.worker.defaultHourlyLimitPerSender,
  });
  res.status(201).json(result);
});

const STATUS_GROUPS = {
  scheduled: ['scheduled', 'sending'],
  sent: ['sent', 'failed'],
} as const;

const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['scheduled', 'sending', 'sent', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const EMAIL_COLUMNS = `id, campaign_id AS "campaignId", sender_id AS "senderId",
  (SELECT s.name FROM senders s WHERE s.id = emails.sender_id) AS "senderName", sender, recipient, subject, body, status,
  scheduled_at AS "scheduledAt", sent_at AS "sentAt", attempts, error,
  preview_url AS "previewUrl", starred, created_at AS "createdAt"`;

type Group = keyof typeof STATUS_GROUPS;

/** Full-text search goes to Elasticsearch; Postgres ILIKE is the fallback if ES is off or unavailable. */
async function searchIds(group: Group, userId: string, filter: string[], q: string, page: number, pageSize: number) {
  if (!searchEnabled()) return null;
  try {
    return await searchEmailIds({ userId, statuses: filter, q, sort: group, from: (page - 1) * pageSize, size: pageSize });
  } catch (err) {
    console.error(`[search] Elasticsearch query failed, falling back to Postgres: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

for (const [group, statuses] of Object.entries(STATUS_GROUPS) as [Group, readonly string[]][]) {
  emailsRouter.get(`/${group}`, async (req, res) => {
    const { q, status, page, pageSize } = listSchema.parse(req.query);
    const filter = status && statuses.includes(status) ? [status] : [...statuses];

    const hits = q ? await searchIds(group, req.user!.id, filter, q, page, pageSize) : null;
    if (hits) {
      // ES decides which emails match and in what order; Postgres supplies the current row data.
      const { rows } = await pool.query(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = ANY($1) AND user_id = $2`, [hits.ids, req.user!.id]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items = hits.ids.map((id) => byId.get(id)).filter(Boolean);
      res.json({ items, total: hits.total, page, pageSize, searchEngine: 'elasticsearch' });
      return;
    }

    const params: unknown[] = [req.user!.id, filter];
    let where = 'user_id = $1 AND status = ANY($2)';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (recipient ILIKE $3 OR subject ILIKE $3)`;
    }
    const order = group === 'scheduled' ? 'scheduled_at ASC' : 'COALESCE(sent_at, updated_at) DESC';
    const [items, total] = await Promise.all([
      pool.query(
        `SELECT ${EMAIL_COLUMNS} FROM emails WHERE ${where} ORDER BY ${order}
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      ),
      pool.query<{ count: string }>(`SELECT count(*) FROM emails WHERE ${where}`, params),
    ]);
    res.json({ items: items.rows, total: Number(total.rows[0].count), page, pageSize, searchEngine: q ? 'postgres' : undefined });
  });
}

emailsRouter.get('/stats', async (req, res) => {
  const { rows } = await pool.query<{ scheduled: string; sent: string }>(
    `SELECT count(*) FILTER (WHERE status IN ('scheduled', 'sending')) AS scheduled,
            count(*) FILTER (WHERE status IN ('sent', 'failed'))       AS sent
     FROM emails WHERE user_id = $1`,
    [req.user!.id],
  );
  res.json({ scheduled: Number(rows[0].scheduled), sent: Number(rows[0].sent) });
});

const idParam = z.object({ id: z.uuid() });

emailsRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = $1 AND user_id = $2`, [id, req.user!.id]);
  if (!rows[0]) throw new HttpError(404, 'Email not found');
  res.json(rows[0]);
});

emailsRouter.patch('/:id/star', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
  const { rows } = await pool.query(
    `UPDATE emails SET starred = $3 WHERE id = $1 AND user_id = $2 RETURNING ${EMAIL_COLUMNS}`,
    [id, req.user!.id, starred],
  );
  if (!rows[0]) throw new HttpError(404, 'Email not found');
  res.json(rows[0]);
});

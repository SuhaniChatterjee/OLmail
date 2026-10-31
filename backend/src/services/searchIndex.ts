import { Client } from '@elastic/elasticsearch';
import { config } from '../config.js';
import { pool } from '../lib/db.js';

/**
 * Elasticsearch mirror of the `emails` table, used for full-text search over
 * scheduled and sent emails. Postgres stays the source of truth: every write
 * re-reads the row and indexes the full document, so a missed update is fixed
 * by the next one (or by `npm run reindex`). When ES is disabled or down, the
 * API falls back to Postgres ILIKE search.
 */
const client = config.elasticsearch.url ? new Client({ node: config.elasticsearch.url }) : null;
const INDEX = config.elasticsearch.index;

export const searchEnabled = () => client !== null;

interface IndexRow {
  id: string;
  user_id: string;
  campaign_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: Date;
  sent_at: Date | null;
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const toDoc = (r: IndexRow) => ({
  userId: r.user_id,
  campaignId: r.campaign_id,
  sender: r.sender,
  recipient: r.recipient,
  subject: r.subject,
  bodyText: stripHtml(r.body),
  status: r.status,
  scheduledAt: r.scheduled_at,
  sentAt: r.sent_at,
  // Sort key for the Sent mailbox, mirroring COALESCE(sent_at, updated_at) in SQL.
  sortAt: r.sent_at ?? r.scheduled_at,
});

const SELECT_ROWS = `SELECT id, user_id, campaign_id, sender, recipient, subject, body, status, scheduled_at, sent_at FROM emails`;

/** Creates the index with explicit mappings if it doesn't exist. Returns true if it was created. */
export async function ensureIndex(): Promise<boolean> {
  if (!client) return false;
  if (await client.indices.exists({ index: INDEX })) return false;
  const prefixText = { type: 'search_as_you_type' as const, fields: { keyword: { type: 'keyword' as const } } };
  await client.indices.create({
    index: INDEX,
    mappings: {
      properties: {
        userId: { type: 'keyword' },
        campaignId: { type: 'keyword' },
        status: { type: 'keyword' },
        sender: prefixText,
        recipient: prefixText,
        subject: prefixText,
        bodyText: { type: 'text' },
        scheduledAt: { type: 'date' },
        sentAt: { type: 'date' },
        sortAt: { type: 'date' },
      },
    },
  });
  return true;
}

async function bulkIndex(rows: IndexRow[]): Promise<void> {
  if (!client || !rows.length) return;
  const operations = rows.flatMap((r) => [{ index: { _index: INDEX, _id: r.id } }, toDoc(r)]);
  const res = await client.bulk({ operations, refresh: 'wait_for' });
  if (res.errors) console.error('[search] Some documents failed to index');
}

/** Never lets a search outage break scheduling or sending. */
async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  if (!client) return;
  try {
    await fn();
  } catch (err) {
    console.error(`[search] ${what} failed: ${err instanceof Error ? err.message : err}`);
  }
}

export const indexCampaign = (campaignId: string) =>
  safely('index campaign', async () => {
    const { rows } = await pool.query<IndexRow>(`${SELECT_ROWS} WHERE campaign_id = $1`, [campaignId]);
    await bulkIndex(rows);
  });

export const indexEmail = (emailId: string) =>
  safely('index email', async () => {
    const { rows } = await pool.query<IndexRow>(`${SELECT_ROWS} WHERE id = $1`, [emailId]);
    await bulkIndex(rows);
  });

/** Rebuilds the whole index from Postgres in batches. */
export async function reindexAll(batchSize = 1000): Promise<number> {
  if (!client) return 0;
  await ensureIndex();
  let total = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { rows } = await pool.query<IndexRow>(`${SELECT_ROWS} WHERE id > $1 ORDER BY id LIMIT $2`, [lastId, batchSize]);
    if (!rows.length) break;
    await bulkIndex(rows);
    total += rows.length;
    lastId = rows[rows.length - 1].id;
  }
  return total;
}

export interface SearchParams {
  userId: string;
  statuses: string[];
  q: string;
  sort: 'scheduled' | 'sent';
  from: number;
  size: number;
}

/** Full-text search; returns matching email ids in display order plus the total hit count. */
export async function searchEmailIds(p: SearchParams): Promise<{ ids: string[]; total: number }> {
  if (!client) throw new Error('Elasticsearch is not configured');
  const res = await client.search({
    index: INDEX,
    from: p.from,
    size: p.size,
    track_total_hits: true,
    _source: false,
    query: {
      bool: {
        filter: [{ term: { userId: p.userId } }, { terms: { status: p.statuses } }],
        must: {
          multi_match: {
            query: p.q,
            type: 'bool_prefix',
            fields: [
              'subject^3', 'subject._2gram', 'subject._3gram',
              'recipient^2', 'recipient._2gram', 'recipient._3gram',
              'sender', 'bodyText',
            ],
          },
        },
      },
    },
    sort: p.sort === 'scheduled' ? [{ scheduledAt: 'asc' }] : [{ sortAt: 'desc' }],
  });
  const total = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
  return { ids: res.hits.hits.map((h) => h._id as string), total };
}

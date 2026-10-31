import { pool } from './lib/db.js';
import { reindexAll, searchEnabled } from './services/searchIndex.js';

/** `npm run reindex`: rebuild the Elasticsearch index from Postgres. */
if (!searchEnabled()) {
  console.error('ELASTICSEARCH_URL is not set');
  process.exit(1);
}
console.log(`[search] Reindexed ${await reindexAll()} email(s)`);
await pool.end();
process.exit(0);

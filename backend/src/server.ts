import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { BULL_BOARD_PATH, createBullBoardRouter } from './lib/bullBoard.js';
import { migrate } from './lib/db.js';
import { errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { emailsRouter } from './routes/emails.js';
import { integrationsRouter } from './routes/integrations.js';
import { sendersRouter } from './routes/senders.js';
import { reconcileScheduledJobs } from './services/emailService.js';
import { ensureIndex, reindexAll, searchEnabled } from './services/searchIndex.js';

const app = express();
app.use(BULL_BOARD_PATH, ...createBullBoardRouter());
app.use(cors({ origin: config.frontendUrls }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/api/config', (_req, res) => {
  res.json({ queueDashboardUrl: `${config.publicApiUrl}${BULL_BOARD_PATH}`, search: searchEnabled() ? 'elasticsearch' : 'postgres' });
});
app.use('/api/auth', authRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/senders', sendersRouter);
app.use('/api/integrations', integrationsRouter);
app.use(errorHandler);

await migrate();
const restored = await reconcileScheduledJobs();
if (restored) console.log(`[api] Re-enqueued ${restored} scheduled email(s) missing from Redis`);

if (searchEnabled()) {
  // A fresh index (first run, or after it was deleted) is backfilled from Postgres.
  try {
    if (await ensureIndex()) console.log(`[search] Created index, backfilled ${await reindexAll()} email(s)`);
  } catch (err) {
    console.error(`[search] Elasticsearch unavailable, search will use Postgres: ${err instanceof Error ? err.message : err}`);
  }
}

app.listen(config.port, () => {
  console.log(`[api] Listening on http://localhost:${config.port}`);
  console.log(`[api] Queue dashboard: ${config.publicApiUrl}${BULL_BOARD_PATH}`);
});

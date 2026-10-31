import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { NextFunction, Request, Response, Router } from 'express';
import { config } from '../config.js';
import { emailQueue } from './queue.js';

export const BULL_BOARD_PATH = '/admin/queues';

/** Optional HTTP Basic auth for the dashboard (BULL_BOARD_USER / BULL_BOARD_PASS). */
function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const { user, pass } = config.bullBoard;
  if (!user || !pass) return next();
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  const [u, p] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
  if (u === user && p === pass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Queues"').status(401).send('Authentication required');
}

/** Live BullMQ dashboard (bull-board) for the email queue. */
export function createBullBoardRouter(): [typeof basicAuth, Router] {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'OLmail' } },
  });
  return [basicAuth, serverAdapter.getRouter()];
}

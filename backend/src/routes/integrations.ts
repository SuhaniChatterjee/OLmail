import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { buildAuthorizeUrl, completeOAuth, disconnectSlack, getSlackStatus, notifyUser, userIdFromState } from '../services/slack.js';

export const integrationsRouter = Router();

/**
 * OAuth redirect target. Slack sends the browser here (no Authorization header),
 * so the user is identified by the signed `state` we generated in /connect.
 */
integrationsRouter.get('/slack/callback', async (req, res) => {
  const back = (result: string, message?: string) => {
    const url = new URL('/scheduled', config.frontendUrl);
    url.searchParams.set('slack', result);
    if (message) url.searchParams.set('message', message);
    res.redirect(url.toString());
  };
  const { code, state, error } = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
  if (error || !code || !state) return back('error', error === 'access_denied' ? 'Slack access was denied' : 'Slack did not return a code');
  try {
    await completeOAuth(userIdFromState(state), code);
    back('connected');
  } catch (err) {
    back('error', err instanceof Error ? err.message : 'Slack connection failed');
  }
});

integrationsRouter.use(requireAuth);

integrationsRouter.get('/slack', async (req, res) => {
  res.json(await getSlackStatus(req.user!.id));
});

/** Returns the Slack authorize URL; the frontend navigates the browser to it. */
integrationsRouter.post('/slack/connect', async (req, res) => {
  res.json({ url: buildAuthorizeUrl(req.user!.id) });
});

integrationsRouter.delete('/slack', async (req, res) => {
  await disconnectSlack(req.user!.id);
  res.status(204).end();
});

integrationsRouter.post('/slack/test', async (req, res) => {
  const sent = await notifyUser(req.user!.id, ':wave: Test message from OLmail. Rate-limit alerts will arrive in this channel.').catch((err: Error) => {
    throw new HttpError(502, err.message);
  });
  if (!sent) throw new HttpError(409, 'Slack is not connected');
  res.json({ ok: true });
});

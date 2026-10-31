import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { createSender, deleteSender, ensureDefaultSender, toPublicSender } from '../services/senderService.js';

export const sendersRouter = Router();
sendersRouter.use(requireAuth);

sendersRouter.get('/', async (req, res) => {
  const senders = await ensureDefaultSender(req.user!.id);
  res.json({ items: senders.map(toPublicSender) });
});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  // Optional existing Ethereal credentials; omit to create a fresh Ethereal mailbox.
  smtpUser: z.email().optional(),
  smtpPass: z.string().min(1).optional(),
});

sendersRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const creds = input.smtpUser && input.smtpPass ? { user: input.smtpUser, pass: input.smtpPass } : undefined;
  const sender = await createSender(req.user!.id, input.name, creds);
  res.status(201).json(toPublicSender(sender));
});

sendersRouter.delete('/:id', async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  await deleteSender(req.user!.id, id);
  res.status(204).end();
});

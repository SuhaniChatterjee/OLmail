import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../lib/db.js';
import { requireAuth, signToken } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash: string | null;
}

const toPublicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url });
const session = (u: UserRow) => ({ token: signToken({ id: u.id, email: u.email }), user: toPublicUser(u) });

const googleClient = new OAuth2Client();
export const authRouter = Router();

/**
 * The frontend uses Google's token flow (custom-styled button), so we receive an
 * access token. We verify it was issued to *our* client ID before trusting it,
 * then read the profile from Google's userinfo endpoint.
 */
authRouter.post('/google', async (req, res) => {
  if (!config.googleClientId) throw new HttpError(501, 'Google login is not configured on the server');
  const { accessToken } = z.object({ accessToken: z.string().min(1) }).parse(req.body);

  const info = await googleClient.getTokenInfo(accessToken).catch(() => {
    throw new HttpError(401, 'Invalid Google token');
  });
  if (info.aud !== config.googleClientId) throw new HttpError(401, 'Google token was issued to a different app');

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) throw new HttpError(401, 'Could not read Google profile');
  const p = (await profileRes.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!p.email || !p.email_verified) throw new HttpError(401, 'Google account email not verified');

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, name, avatar_url, google_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, google_id = EXCLUDED.google_id
     RETURNING *`,
    [p.email.toLowerCase(), p.name ?? p.email, p.picture ?? null, p.sub],
  );
  res.json(session(rows[0]));
});

/** Email + password: logs in an existing account, or signs up a new one. */
authRouter.post('/email', async (req, res) => {
  const body = z
    .object({ email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(6, 'Password must be at least 6 characters') })
    .parse(req.body);

  const existing = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [body.email]);
  const user = existing.rows[0];
  if (user) {
    if (!user.password_hash) throw new HttpError(401, 'This account uses Google login');
    if (!(await verifyPassword(body.password, user.password_hash))) throw new HttpError(401, 'Incorrect email or password');
    res.json(session(user));
    return;
  }

  const localPart = body.email.split('@')[0];
  const name = localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const { rows } = await pool.query<UserRow>(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [body.email, name, await hashPassword(body.password)],
  );
  res.status(201).json(session(rows[0]));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
  if (!rows[0]) throw new HttpError(401, 'User no longer exists');
  res.json({ user: toPublicUser(rows[0]) });
});

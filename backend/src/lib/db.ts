import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  google_id   TEXT UNIQUE,
  password_hash TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  delay_ms        INTEGER NOT NULL,
  hourly_limit    INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender        TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  message_id    TEXT,
  preview_url   TEXT,
  starred       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient)
);

CREATE INDEX IF NOT EXISTS emails_user_status_idx ON emails (user_id, status, scheduled_at);

-- SMTP identities a user can send from. Each one is its own Ethereal mailbox,
-- and rate limits are counted per sender.
CREATE TABLE IF NOT EXISTS senders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  smtp_host   TEXT NOT NULL,
  smtp_port   INTEGER NOT NULL,
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);

ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES senders(id) ON DELETE SET NULL;

-- One Slack workspace connection per user, written by the OAuth callback.
CREATE TABLE IF NOT EXISTS slack_connections (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL,
  team_name     TEXT NOT NULL,
  channel       TEXT,
  webhook_url   TEXT NOT NULL,
  access_token  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate(): Promise<void> {
  // Advisory lock so API and worker booting together don't race on DDL
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}

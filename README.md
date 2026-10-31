# OLmail

**OLmail** (Outbox Labs Mail) is a full-stack email scheduler. Users log in (Google or email/password), compose a campaign with a recipient list, and schedule it. Emails are sent at the scheduled time through **Ethereal SMTP** from one of several **senders** by a **BullMQ** worker. It has per-sender and global hourly rate limiting, a global send throttle, configurable concurrency, and persistence that survives restarts. Emails are searchable through **Elasticsearch**, the queue is visible live in a **BullMQ dashboard**, and a **Slack** alert (connected with OAuth) fires when a sender hits its hourly limit.

```
.
├── docker-compose.yml        # Redis (AOF on) + Postgres + Elasticsearch
├── sample-recipients.csv     # try "Upload List" with this
├── backend/                  # Express API + BullMQ worker (TypeScript)
│   └── src/
│       ├── server.ts         # API entry point (+ BullMQ dashboard at /admin/queues)
│       ├── worker.ts         # BullMQ worker entry point
│       ├── reindex.ts        # `npm run reindex`: rebuild the Elasticsearch index from Postgres
│       ├── config.ts         # env parsing
│       ├── lib/              # db (schema/migrate), redis, queue, bullBoard, auth (JWT), http errors, password hashing
│       ├── routes/           # /api/auth, /api/emails, /api/senders, /api/integrations
│       └── services/         # emailService (scheduling + reconcile), rateLimiter, mailer, senderService, searchIndex (ES), slack
└── frontend/                 # React 19 + Vite + Tailwind v4 (TypeScript)
    └── src/
        ├── components/ui/    # Button, Input, NumberBox, Badge, Avatar, Popover, Spinner, EmptyState, icons
        ├── components/layout # AppLayout, Sidebar, UserMenu, IntegrationsPanel (Slack + queue link), ProtectedRoute, Logo
        ├── components/email/ # EmailRow, StatusBadge, StarButton, MailboxToolbar, RecipientField, SenderSelect, RichTextEditor, SendLaterPopover
        ├── context/          # AuthContext, ToastContext
        ├── hooks/            # useAsync (fetch + polling), useDebounce
        ├── lib/              # typed API client, formatters, recipient parsing
        ├── pages/            # Login, Mailbox (Scheduled/Sent), EmailDetail, Compose
        └── types/api.ts      # API response/request types
```

---

## Running it

**Prerequisites:** Node 20+, Docker (or a local Redis 6.2+ and Postgres 13+).

### Quick start: one command

```bash
make          # same as ./scripts/dev.sh
```

No keys are needed to try it. With the `.env` files created from the examples, sign up with email and password on the login page; Ethereal creates a throwaway SMTP account by itself, so scheduling, the restart scenario and rate limiting all work. Google login needs `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`, and Slack alerts need the `SLACK_*` keys plus `NGROK_AUTHTOKEN`.

`scripts/dev.sh` does all of the steps below in one go:

- Starts Docker Desktop if it isn't running.
- Creates the `.env` files from `.env.example` if they're missing.
- Stops anything else holding ports 4000, 5173, 6379, 54329 or 9200.
- Starts Redis, Postgres and Elasticsearch and waits until they're ready.
- Installs npm dependencies when needed.
- Starts an ngrok tunnel, or reuses one that's already running, and writes its https URL into `PUBLIC_API_URL` and `SLACK_REDIRECT_URI`.
- Runs the API, worker and frontend with their logs prefixed `[api]`, `[worker]` and `[web]`.

Ctrl-C stops the app processes; the Docker services keep running.

If the ngrok URL changes, the script prints the new Slack redirect URL to add in your Slack app.

Other targets:

| Command | What it does |
|---|---|
| `make dev-local` | Run without ngrok (`NO_TUNNEL=1`); Slack connect won't work |
| `make stop` | Stop the app, ngrok and the Docker services |
| `make infra` / `make infra-down` | Start / stop only Redis, Postgres and Elasticsearch |
| `make install`, `make build`, `make typecheck`, `make lint`, `make reindex` | The usual npm scripts for both apps |

Options for the script: `NGROK_DOMAIN=…` uses a specific ngrok domain, and `NO_KILL=1` leaves processes on our ports alone.

The manual steps follow.

### 1. Start Redis, Postgres and Elasticsearch

```bash
docker compose up -d
```

Postgres is exposed on host port **54329** (to avoid clashing with a local Postgres on 5432), Redis on **6379**, and Elasticsearch on **9200** (single node, security off, 512 MB heap). To use your own instances, change `DATABASE_URL` / `REDIS_URL` / `ELASTICSEARCH_URL` in `backend/.env`. Elasticsearch is optional at runtime: if `ELASTICSEARCH_URL` is empty or ES is down, search falls back to Postgres `ILIKE`.

### 2. Backend (API + worker)

```bash
cd backend
cp .env.example .env      # adjust as needed
npm install
npm run dev               # API on http://localhost:4000  (terminal 1)
npm run dev:worker        # BullMQ worker                  (terminal 2)
```

The database schema is created automatically on startup; there's no separate migration step. The Elasticsearch index is created (and backfilled from Postgres) on the first API boot; `npm run reindex` rebuilds it at any time. Production: `npm run build && npm start` / `npm run start:worker`.

**BullMQ dashboard:** http://localhost:4000/admin/queues (also linked as "Queue dashboard" in the app sidebar). It shows delayed, waiting, active, completed and failed jobs live. Set `BULL_BOARD_USER` / `BULL_BOARD_PASS` to put it behind HTTP Basic auth.

The API and worker are separate processes on purpose: you can run several workers, and the rate limits and throttle still hold globally because they live in Redis.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

### 4. Ethereal Email

[Ethereal](https://ethereal.email) is a fake SMTP service: messages are accepted but never delivered, and you can view them in its web inbox.

Each **sender** is its own Ethereal mailbox (SMTP account), stored in the `senders` table:

- **Zero setup:** leave `ETHEREAL_USER` / `ETHEREAL_PASS` empty. A user's first sender is created automatically with `nodemailer.createTestAccount()` the first time they open Compose.
- **Stable inbox:** create an account at https://ethereal.email/create and put the credentials in `backend/.env`. Every user's *default* sender then uses that account.
- **More senders:** in Compose, open the **From** dropdown → "New sender" to create another Ethereal mailbox. You can also `POST /api/senders` with `{ name, smtpUser, smtpPass }` to add an existing Ethereal account (the credentials are verified first).

Every sent email stores its Ethereal **preview URL**. Open any sent email in the dashboard and click "View delivered message on Ethereal".

### 5. Google login (optional)

1. In Google Cloud Console, create an **OAuth client ID** of type *Web application*.
2. Add `http://localhost:5173` to **Authorized JavaScript origins**.
3. Set the same client ID in `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env` (`VITE_GOOGLE_CLIENT_ID`).

Without it, email/password login works out of the box: the first login with a new email creates the account.

### 6. Slack alerts (rate-limit notifications)

1. Create a Slack app at https://api.slack.com/apps (From scratch) and pick your workspace.
2. **OAuth & Permissions** → add the bot scope **`incoming-webhook`**, and add your redirect URL: `<PUBLIC_API_URL>/api/integrations/slack/callback`.
3. Copy the **Client ID** and **Client Secret** into `backend/.env` (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`) and set `SLACK_REDIRECT_URI` to the same redirect URL.
4. Slack only accepts **HTTPS** redirect URLs, so for local dev expose the API through a tunnel, e.g. `ngrok http 4000`. Then set `PUBLIC_API_URL` and `SLACK_REDIRECT_URI` to the `https://…ngrok…` URL.
5. In the dashboard sidebar, click **Connect Slack**. Slack's consent screen asks which channel to post to, and you're sent back to the dashboard with a "Slack connected" toast. **Test** posts a message straight away.

The connection is stored per user in Postgres (`slack_connections`) and looked up when a notification is sent. So connecting, reconnecting (which replaces the channel) or disconnecting takes effect immediately in every worker, without a restart. If a user hasn't connected Slack, limit hits are just logged.

### Environment variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin |
| `DATABASE_URL` | `postgres://scheduler:scheduler@localhost:54329/scheduler` | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Redis (BullMQ + rate limit counters) |
| `JWT_SECRET` | `change-me` | Signs session tokens |
| `PUBLIC_API_URL` | `http://localhost:<PORT>` | Public URL of the API (Slack redirect, dashboard link) |
| `GOOGLE_CLIENT_ID` | – | Enables Google login |
| `ETHEREAL_USER` / `ETHEREAL_PASS` | – | Credentials for each user's default sender; a new Ethereal account is created if empty |
| `ELASTICSEARCH_URL` | – | e.g. `http://localhost:9200`; empty = Postgres search fallback |
| `ELASTICSEARCH_INDEX` | `emails` | Index name |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | – | Slack app for OAuth; empty hides "Connect Slack" |
| `SLACK_REDIRECT_URI` | `<PUBLIC_API_URL>/api/integrations/slack/callback` | Must match the Slack app's redirect URL |
| `BULL_BOARD_USER` / `BULL_BOARD_PASS` | – | Optional Basic auth for `/admin/queues` |
| `WORKER_CONCURRENCY` | `5` | Jobs processed in parallel per worker process |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Global minimum gap between two sends (all workers) |
| `MAX_EMAILS_PER_HOUR` | `200` | Global hourly cap across all senders |
| `DEFAULT_HOURLY_LIMIT_PER_SENDER` | `50` | Per-sender cap when Compose leaves "Hourly Limit" empty |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `500` | Hard per-sender ceiling; a campaign's Hourly Limit can only lower it |

---

## Deploying

The backend (API, worker, Postgres, Redis) runs on [Railway](https://railway.com) and the frontend on [Vercel](https://vercel.com). Elasticsearch is optional; without it search uses Postgres.

### Free option: Render

`render.yaml` deploys everything on Render's free plan: the API and worker in one process (`npm run start:all`), the frontend as a static site, Postgres and Key Value (Redis).

1. On [render.com](https://render.com), **New → Blueprint**, pick this repo, and apply. Leave `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` empty to use email/password login only.
2. The app is at `https://olmail-suhani.onrender.com`, the API at `https://olmail-suhani-api.onrender.com`. If Render assigns different URLs, update `FRONTEND_URL` and `VITE_API_URL` to match.

Free-plan limits: the API sleeps after 15 minutes idle (the first request takes about a minute), the free Postgres expires after 30 days, and Key Value isn't persisted (scheduled jobs are re-queued from Postgres on startup).

### Railway (backend)

1. **New Project → Deploy from GitHub repo**, pick this repo. Then **+ New → Database** and add **PostgreSQL** and **Redis**.
2. **API service** (the one created from the repo): Settings → Root Directory `backend`. It picks up `backend/railway.json` (build, `npm start`, health check on `/api/health`). Under Networking, **Generate Domain**.
3. **Worker service**: **+ New → GitHub Repo**, same repo. Root Directory `backend`, and set **Config-as-code file path** to `/backend/railway.worker.json`. It needs no domain.
4. Variables, on **both** services:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `FRONTEND_URL` | the Vercel URL, e.g. `https://olmail.vercel.app` (comma-separate to allow more than one) |
   | `PUBLIC_API_URL` | the API's Railway domain, e.g. `https://olmail-api.up.railway.app` |
   | `GOOGLE_CLIENT_ID` | optional, same as the frontend's |
   | `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | optional |
   | `BULL_BOARD_USER` / `BULL_BOARD_PASS` | recommended, protects `/admin/queues` |

   Tables are created automatically on startup.

### Vercel (frontend)

1. **Add New → Project**, import this repo, set Root Directory to `frontend` (framework: Vite). `frontend/vercel.json` makes client-side routes like `/mailbox` work on refresh.
2. Environment variables: `VITE_API_URL` = the Railway API URL, and optionally `VITE_GOOGLE_CLIENT_ID`.
3. Deploy, then put the Vercel URL into `FRONTEND_URL` on Railway (both services) and redeploy them.

### After deploying

- **Google login**: add the Vercel URL to the OAuth client's *Authorized JavaScript origins* in Google Cloud Console.
- **Slack**: add `https://<railway-api-domain>/api/integrations/slack/callback` to the Slack app's Redirect URLs. No ngrok tunnel needed.
- Emails go through Ethereal, so nothing reaches real inboxes.

## API

All routes except login and the Slack callback require `Authorization: Bearer <token>`.

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/api/auth/email` | `{ email, password }` | Log in, or sign up if the email is new |
| POST | `/api/auth/google` | `{ accessToken }` | Google OAuth access token |
| GET | `/api/auth/me` | | Current user |
| POST | `/api/emails/schedule` | `{ subject, body, recipients[], startTime, delayBetweenSeconds?, hourlyLimit?, senderId? }` | Creates the campaign and its jobs (default sender if `senderId` is omitted) |
| GET | `/api/emails/scheduled` | `?q=&status=&page=` | Status `scheduled` / `sending`, soonest first. `q` → Elasticsearch full-text search |
| GET | `/api/emails/sent` | `?q=&status=&page=` | Status `sent` / `failed`, newest first. `q` → Elasticsearch full-text search |
| GET | `/api/emails/stats` | | Sidebar counts |
| GET | `/api/emails/:id` | | Single email |
| PATCH | `/api/emails/:id/star` | `{ starred }` | |
| GET | `/api/senders` | | The user's senders (creates the default one on first call) |
| POST | `/api/senders` | `{ name, smtpUser?, smtpPass? }` | New sender: fresh Ethereal mailbox, or existing credentials |
| DELETE | `/api/senders/:id` | | Refused while the sender has scheduled emails |
| GET | `/api/integrations/slack` | | `{ configured, connected, teamName, channel }` |
| POST | `/api/integrations/slack/connect` | | Returns the Slack authorize URL |
| GET | `/api/integrations/slack/callback` | `?code=&state=` | OAuth redirect target; stores the webhook, redirects to the dashboard |
| POST | `/api/integrations/slack/test` | | Posts a test message |
| DELETE | `/api/integrations/slack` | | Disconnects (and revokes the token) |
| GET | `/api/config` | | Queue dashboard URL and the active search engine |
| GET | `/admin/queues` | | BullMQ dashboard (bull-board) |

Example (curl / Postman):

```bash
TOKEN=$(curl -s localhost:4000/api/auth/email -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"secret123"}' | jq -r .token)

curl -s localhost:4000/api/emails/schedule -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "subject": "Hello",
  "body": "<p>Hi there!</p>",
  "recipients": ["a@example.com","b@example.com","c@example.com"],
  "startTime": "'"$(date -u -v+1M +%Y-%m-%dT%H:%M:%SZ)"'",
  "delayBetweenSeconds": 10,
  "hourlyLimit": 2
}'
```

---

## Architecture

```
 React ──HTTP──▶ Express API ──INSERT──▶ Postgres (source of truth: users, senders, campaigns, emails, slack_connections)
                     │   │
                     │   └──bulk index──▶ Elasticsearch "emails" (search mirror)
                     │
                     ├──queue.add(jobId=emailId, delay)──▶ Redis / BullMQ "email-send" (delayed set)
                     └── /admin/queues (bull-board) ◀──────────┤
                                                               │
                                          BullMQ Worker(s) ◀───┘  concurrency N
                                               │  1. load email + sender SMTP account (skip if already sent)
                                               │  2. Lua: reserve hourly slot (per sender + global)
                                               │       └ window full → slot reserved in next free window,
                                               │         moveToDelayed(slot time), DelayedError,
                                               │         one Slack alert per sender per hour
                                               │  3. Redis send gate: wait for a global slot ≥ MIN_DELAY after the last send
                                               │  4. claim row → 'sending'
                                               │  5. SMTP via the sender's Ethereal account → 'sent' + preview URL
                                               ▼
                                         Postgres status update → re-index in Elasticsearch
```

### How scheduling works

- `POST /api/emails/schedule` writes one `campaigns` row and one `emails` row per unique recipient **in a single transaction**. Email *i* gets `scheduled_at = startTime + i × delayBetweenSeconds`.
- After the commit, each email gets a **BullMQ delayed job** with `delay = scheduled_at − now` and `jobId = email.id`. No cron or polling: Redis holds each job in BullMQ's delayed sorted set and promotes it when it's due.
- Jobs have 3 attempts with exponential backoff (30s, 60s, …). Between attempts the email goes back to `scheduled` with the error recorded; after the last attempt it becomes `failed`.

### How persistence on restart is handled

- **Postgres is the source of truth** for every email and its status. **Redis holds the timers.** Redis runs with **AOF persistence** (`--appendonly yes`) and `noeviction`, so delayed jobs survive a Redis restart.
- **API/worker restart:** jobs live in Redis, not in process memory, so stopping and restarting either process loses nothing. When the worker comes back, it picks up any job that came due while it was down and sends it right away. Jobs that were mid-flight when a worker died are recovered by BullMQ's stalled-job detection.
- **Reconciliation on boot:** when the API starts, it finds every `scheduled`/`sending` email in Postgres and re-adds any job missing from Redis. Since `jobId = emailId`, re-adding an existing job is a no-op. This covers Redis data loss, or a crash between the DB commit and the enqueue.
- **Idempotency:** `jobId = emailId` means BullMQ can only ever hold one job per email. Before sending, the worker checks the row and skips emails already `sent`/`failed`. The `UPDATE … WHERE status IN ('scheduled','sending')` claim keeps two workers from both moving the same email forward. Each message also gets a stable `Message-ID` (`<emailId@…>`), so a duplicate would be recognisable downstream.

**Demoing it:** schedule emails 1–2 minutes ahead → stop the API and worker (Ctrl-C) → wait past the send time → start them again → the emails go out right away and move to **Sent**.

### How rate limiting and concurrency work

| Mechanism | Where | Behavior |
|---|---|---|
| **Delay between emails** (per campaign) | `scheduled_at` offsets | Spreads a campaign's sends: email *i* fires at `start + i × delay`. |
| **Hourly limit per sender** (Compose "Hourly Limit", capped by `MAX_EMAILS_PER_HOUR_PER_SENDER`) | Redis key `ratelimit:sender:<senderId>:<hourWindow>` | Checked and incremented atomically by a Lua script. |
| **Global hourly cap** (`MAX_EMAILS_PER_HOUR`) | Redis key `ratelimit:global:<hourWindow>` | Same Lua script, so both limits update in one atomic step. |
| **Slack alert on limit hit** | Redis `SET ratelimit:notified:<senderId>:<hourWindow> NX` | Exactly one alert per sender per hour, even with many workers racing. |
| **Global min gap** (`MIN_DELAY_BETWEEN_EMAILS_MS`) | Redis key `throttle:next-send` (Lua) | Each send atomically takes slot = max(now, last slot + gap) and waits for it, across all worker processes. It's applied only to jobs about to hit SMTP, so jobs pushed to a later hour don't use up throttle time. Max wait per job ≈ workers × concurrency × gap. |
| **Concurrency** (`WORKER_CONCURRENCY`) | BullMQ `Worker({ concurrency })` | Parallel jobs per process; add processes to scale out. |

**When the hourly limit is reached**, the email is **not failed or dropped**. The Lua script walks forward from the current hour window to the first window where *both* the sender counter and the global counter have room, and **reserves the slot there**: it increments that window's counters and returns the slot's position *n*. The worker then:

1. stores `reservedWindow` in the job data (`job.updateData`), so the job doesn't count against that window a second time when it wakes up,
2. moves the job to `windowStart + (n − 1) × MIN_DELAY_BETWEEN_EMAILS_MS` with `job.moveToDelayed`, and throws `DelayedError` (this doesn't use up a retry attempt),
3. updates the row's `scheduled_at` (and the ES document), so the dashboard shows the real send time,
4. sends a **Slack alert** if this is the first limit hit for that sender in this hour.

Slots are handed out in the order jobs reach the rate limiter, and they get increasing offsets inside the window, so the backlog **keeps its order** and is released steadily rather than all at once at the top of the hour. Windows are fixed clock hours (e.g. 14:00–15:00). Because reserve-and-increment is a single Lua script, any number of concurrent workers or processes can't overshoot a limit or hand out the same slot twice. The Slack alert also fires the moment a send takes the sender's *last* slot in the current hour.

### Behavior under load (1000+ emails at the same time)

Say 1,000 emails are scheduled for 10:00 from one sender, with Hourly Limit = 200, `MAX_EMAILS_PER_HOUR=200`, `MIN_DELAY_BETWEEN_EMAILS_MS=2000` and `WORKER_CONCURRENCY=5`:

- **Scheduling** is one transaction (`INSERT … SELECT unnest(…)`) plus one `addBulk` call to Redis, so it's fast, and the ES index is a single bulk request.
- At 10:00, all 1,000 delayed jobs become waiting and are picked up 5 at a time per worker. The first 200 get hourly slots in 10:00–11:00 and then pass through the Redis send gate, **one SMTP send every 2 s across all workers** (200 sends ≈ 7 minutes).
- The other 800 never touch the send gate. As soon as the window is full, they're rescheduled at full worker speed (tested: 990 over-limit emails rescheduled in under 5 seconds). Job 201 reserves slot 1 of 11:00, and a **Slack alert** goes out. Jobs 202–400 reserve slots 2–200 of 11:00 (11:00:00, 11:00:02, …), 401–600 get 12:00, and so on. Nothing is dropped or failed, and every row in the dashboard shows its real new time.
- **Restart in the middle:** reservations live in Redis (AOF) and in the job data, so they survive. A job whose reserved window has already passed (because the worker was down) simply reserves again.
- With several senders, each has its own counter, so one busy sender doesn't stall the others. They only share the global cap.

**Demoing it:** set `MIN_DELAY_BETWEEN_EMAILS_MS=1000`. Then upload `sample-recipients.csv` (7 recipients) with Hourly Limit = 3 and delay = 0. Three send right away. The other four show new scheduled times in the next hour (spaced 1 s apart), the worker logs `sender hourly limit hit, rescheduled to …`, and your Slack channel gets the alert.

### How search works (Elasticsearch)

- Index `emails`: `userId` / `status` / `campaignId` keywords; `subject`, `recipient` and `sender` as `search_as_you_type` (prefix matching as you type, e.g. `jo` finds `john@…`); `bodyText` (HTML stripped) as full text; plus date fields for sorting.
- **Writes:** the API bulk-indexes a campaign's emails after they're scheduled. The worker re-indexes an email after every status change (sent, failed, rescheduled). Each write re-reads the row from Postgres, so the document is always a full, current copy.
- **Reads:** when the Scheduled/Sent search box has text, the API runs a `bool_prefix` `multi_match` query, filtered by user and status, and sorted like the mailbox. It then loads those rows from Postgres to return the current data.
- **Resilience:** indexing errors are logged and never block scheduling or sending. If ES is down or not configured, search falls back to Postgres `ILIKE`. On first boot (or after the index is deleted), the API recreates and backfills it, and `npm run reindex` rebuilds it by hand.

---

## Features implemented

**Backend**
- ✅ **Scheduler:** BullMQ delayed jobs (no cron), with per-campaign start time and delay between emails
- ✅ **Persistence:** Postgres source of truth, Redis AOF, boot-time reconciliation, idempotent job IDs, safe to restart
- ✅ **Multiple senders:** each sender is its own Ethereal SMTP account, picked in Compose; rate limits are per sender
- ✅ **Rate limiting:** atomic per-sender and global hourly limits (Lua, Redis counters keyed by `sender + hour window`); over-limit emails reserve a slot in the next free window, in order, instead of failing
- ✅ **Slack alerts:** real OAuth v2 flow (`incoming-webhook`), stored per user, one alert per sender per hour on a limit hit, test button, disconnect/reconnect without a restart
- ✅ **Elasticsearch search** over scheduled and sent emails (subject, recipient, sender, body), with a Postgres fallback and a reindex script
- ✅ **Live BullMQ dashboard** (bull-board) at `/admin/queues`, with optional Basic auth
- ✅ **Concurrency:** configurable worker concurrency, a global min-delay throttle across workers, horizontally scalable workers
- ✅ Retries with exponential backoff and a final `failed` state with the error message
- ✅ Ethereal SMTP with auto-created test account and stored preview URLs
- ✅ Auth: Google OAuth (access token checked against our client ID) and email/password (scrypt), JWT sessions
- ✅ Validation with zod, central error handling, graceful worker shutdown

**Frontend** (built from the provided designs)
- ✅ **Login:** Google button and email/password form
- ✅ **Dashboard:** sidebar with user card (logout menu), Compose button, Scheduled/Sent nav with live counts
- ✅ **Scheduled and Sent lists:** time badge (scheduled) or Sent/Failed/Sending badge, subject and preview, star toggle, debounced search, status filter, refresh, pagination, 10s auto-refresh
- ✅ **Email detail:** sender, recipient, time, status, sanitized HTML body, Ethereal preview link, failure reason
- ✅ **Compose:** From (sender dropdown and "New sender"), recipient chips (type, paste, or **Upload List** CSV/TXT with dedupe and count, "+N" collapse), Subject, Delay between emails, Hourly Limit, rich-text editor, **Send Later** popover (date-time picker and presets)
- ✅ **Integrations panel:** Connect/Test/Disconnect Slack and a link to the queue dashboard
- ✅ Loading spinners, empty states (with and without filters), error states with retry, toast notifications
- ✅ Reusable UI components, typed API client and response types, protected routes, auto-logout on 401

---

## Assumptions, shortcuts and trade-offs

- **Delay units:** "Delay between 2 emails" is in **seconds**.
- **Hourly limit scope:** counted **per sender (SMTP account) per clock hour**. The value comes from the campaign; if two campaigns from the same sender set different limits, each email is checked against its own campaign's limit using the shared sender counter. Fixed windows (not sliding) keep it simple and predictable; up to 2× the limit can go out around an hour boundary.
- **Reservation drift:** a job that reserved a slot in a future window and then fails SMTP may retry in a later window, where it counts again. That's harmless (it can only make the limit stricter). The reservation script builds its Redis keys inside Lua, which is fine on a single Redis node but would need hash-tagged keys for Redis Cluster.
- **SMTP passwords** for senders are stored in plain text in Postgres. They're throwaway Ethereal credentials and are never returned by the API; a real deployment would encrypt them or use a secrets manager.
- **Slack:** uses the `incoming-webhook` scope (one channel per user, chosen on Slack's consent screen) rather than a bot token with `chat:write`. A webhook revoked on Slack's side shows up as a logged delivery error, not a crash.
- **Search consistency:** Elasticsearch is updated after each Postgres write, so it's eventually consistent. Results always show current Postgres data, but the matched set can be a moment behind.
- **At-least-once delivery:** if a worker dies *after* SMTP accepted a message but *before* the DB update, the retry can send it again. SMTP has no idempotency key, so exactly-once isn't achievable without a provider that supports one.
- **Email/password doubles as sign-up:** matching the "or sign up through email" design, the first login with a new email creates the account. There's no email verification or password reset.
- **JWT in localStorage:** simple for a demo; an httpOnly cookie would be safer in production.
- **Not implemented from the mockups:** attachments (paperclip), and archive/delete actions on the detail page (starring works).
- **Rich text editor** uses `contentEditable` + `execCommand`. It's deprecated but supported everywhere and needs no dependency. HTML is sanitized with DOMPurify when displayed.
- **Schema** is applied with idempotent `CREATE … IF NOT EXISTS` on boot rather than a migration tool.
- **Postgres host port 54329** in docker-compose avoids conflicts with a local Postgres.

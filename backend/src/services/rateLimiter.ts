import type { Redis } from 'ioredis';
import { config } from '../config.js';

export const HOUR_MS = 3_600_000;
/** How far ahead (in hour windows) we look for free capacity: one week. */
const MAX_LOOKAHEAD_WINDOWS = 24 * 7;

/**
 * Reserves one send slot for a sender in the earliest hour window (starting at
 * ARGV[2]) where both the per-sender and the global counter are under their
 * limit, and increments both. It all runs as one Lua script, so any number of
 * concurrent workers/processes can never overshoot a limit or hand out the same
 * slot twice.
 *
 * Returns { window, positionInWindow, blockedBy } where blockedBy says which
 * limit (if any) was already full in the starting window.
 *
 * Keys are built inside the script (the number of windows probed isn't known up
 * front), which is fine on a single Redis node but not Redis Cluster-safe.
 */
const RESERVE_SCRIPT = `
local sender = ARGV[1]
local start = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local globalLimit = tonumber(ARGV[4])
local lookahead = tonumber(ARGV[5])
local hourMs = tonumber(ARGV[6])
local now = tonumber(ARGV[7])
local blockedBy = ''
for i = 0, lookahead - 1 do
  local w = start + i
  local sk = 'ratelimit:sender:' .. sender .. ':' .. w
  local gk = 'ratelimit:global:' .. w
  local s = tonumber(redis.call('GET', sk) or '0')
  local g = tonumber(redis.call('GET', gk) or '0')
  if s < senderLimit and g < globalLimit then
    local ttl = (w + 1) * hourMs - now + 60000
    local pos = redis.call('INCR', sk)
    redis.call('INCR', gk)
    redis.call('PEXPIRE', sk, ttl)
    redis.call('PEXPIRE', gk, ttl)
    return { w, pos, blockedBy }
  end
  if i == 0 then
    if s >= senderLimit then blockedBy = 'sender' else blockedBy = 'global' end
  end
end
return { -1, 0, blockedBy }
`;

export type LimitKind = 'sender' | 'global';

export type ReserveResult =
  /** Slot is in the current window: send now. `filledLimit` is set when this send used the last sender slot. */
  | { ok: true; window: number; filledLimit: boolean }
  /** Current window is full; a slot was reserved in `window`, run the job at `runAt`. */
  | { ok: false; window: number; runAt: number; blockedBy: LimitKind }
  /** Nothing free within the lookahead; try again at `runAt` without a reservation. */
  | { ok: false; window: null; runAt: number; blockedBy: LimitKind };

export const hourWindow = (ms: number) => Math.floor(ms / HOUR_MS);

export class HourlyRateLimiter {
  constructor(private redis: Redis) {}

  async reserve(senderKey: string, senderLimit: number, now = Date.now()): Promise<ReserveResult> {
    const current = hourWindow(now);
    const [window, position, blockedBy] = (await this.redis.eval(
      RESERVE_SCRIPT,
      0,
      senderKey,
      current,
      senderLimit,
      config.worker.maxPerHour,
      MAX_LOOKAHEAD_WINDOWS,
      HOUR_MS,
      now,
    )) as [number, number, string];

    if (window === current) return { ok: true, window, filledLimit: position >= senderLimit };

    const blocked = (blockedBy || 'sender') as LimitKind;
    if (window === -1) return { ok: false, window: null, runAt: (current + 1) * HOUR_MS, blockedBy: blocked };

    // Space reserved jobs out inside their window in reservation order, so the
    // backlog is released FIFO instead of all at once at the top of the hour.
    const spacing = Math.max(config.worker.minDelayMs, 250);
    const offset = Math.min((position - 1) * spacing, HOUR_MS - 1000);
    return { ok: false, window, runAt: window * HOUR_MS + offset, blockedBy: blocked };
  }

  /**
   * True exactly once per (sender, window): used to fire a single Slack alert
   * when a sender's hourly limit is hit, even with many workers racing.
   */
  async markLimitNotified(senderKey: string, window: number, now = Date.now()): Promise<boolean> {
    const ttl = (window + 1) * HOUR_MS - now + 60_000;
    const res = await this.redis.set(`ratelimit:notified:${senderKey}:${window}`, '1', 'PX', Math.max(ttl, 1000), 'NX');
    return res === 'OK';
  }
}

/**
 * Hands out SMTP send times at least `gapMs` apart across every worker process:
 * slot = max(now, previous slot + gap). Returns the slot time (ms).
 */
const THROTTLE_SCRIPT = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, nextFree)
redis.call('SET', KEYS[1], string.format('%.0f', slot + gap), 'PX', string.format('%.0f', slot + gap - now + 60000))
return string.format('%.0f', slot)
`;

/**
 * Global minimum gap between two sends. Only jobs that are actually about to
 * hit SMTP pass through here; jobs pushed to a later hour never take a slot,
 * so a large over-limit backlog is rescheduled at full worker speed.
 */
export class SendThrottle {
  constructor(private redis: Redis, private gapMs: number) {}

  /** Waits until this process may send. Max wait ≈ (workers × concurrency) × gap. */
  async waitForTurn(): Promise<void> {
    if (this.gapMs <= 0) return;
    const now = Date.now();
    const slot = Number(await this.redis.eval(THROTTLE_SCRIPT, 1, 'throttle:next-send', now, this.gapMs));
    const wait = slot - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

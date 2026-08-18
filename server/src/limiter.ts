import { rateLimit, ipKeyGenerator, MemoryStore, type Store, type Options, type IncrementResponse } from "express-rate-limit";
import type { Request } from "express";
import { config } from "./config.js";
import { query } from "./db.js";
import type { AuthedRequest } from "./auth.js";

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED" },
} as const;

/**
 * Postgres-backed store so rate-limit counters are shared across all server
 * instances (Render spins up multiple replicas; in-memory counters are
 * per-instance and reset on restart). Uses a single `rate_limits` table; each
 * limiter instance gets its own `prefix` so counters never collide.
 */
export class PgRateLimitStore implements Store {
  localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private increments = 0;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options) {
    if (typeof options.windowMs === "number" && options.windowMs > 0) {
      this.windowMs = options.windowMs;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    const fullKey = `${this.prefix}:${key}`;
    const { rows } = await query(
      `insert into rate_limits (key, hits, reset_at)
       values ($1, 1, now() + make_interval(secs => $2 / 1000.0))
       on conflict (key) do update
       set hits = case when rate_limits.reset_at <= now() then 1 else rate_limits.hits + 1 end,
           reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
       returning hits, reset_at`,
      [fullKey, this.windowMs],
    );
    this.increments += 1;
    if (this.increments % 256 === 0) {
      void query(`delete from rate_limits where reset_at <= now()`).catch(() => {});
    }
    return { totalHits: Number(rows[0].hits), resetTime: rows[0].reset_at as Date };
  }

  async decrement(key: string): Promise<void> {
    await query(`update rate_limits set hits = greatest(hits - 1, 0) where key = $1`, [
      `${this.prefix}:${key}`,
    ]);
  }

  async resetKey(key: string): Promise<void> {
    await query(`delete from rate_limits where key = $1`, [`${this.prefix}:${key}`]);
  }

  async resetAll(): Promise<void> {
    await query(`delete from rate_limits where key like $1`, [`${this.prefix}:%`]);
  }

  async shutdown(): Promise<void> {}
}

export function makeStore(prefix: string): Store {
  if (config.rateLimitStore === "postgres") return new PgRateLimitStore(prefix);
  return new MemoryStore();
}

const apiStore = makeStore("api");
const authStore = makeStore("auth");
const tradeStore = makeStore("trade");

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: config.rateLimit.apiPerMin,
  store: apiStore,
});

export const authLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: config.rateLimit.authPerMin,
  store: authStore,
});

export const tradeLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: config.rateLimit.tradePerMin,
  store: tradeStore,
  keyGenerator: (req: Request) => {
    const authed = req as AuthedRequest;
    if (authed.team?.team_id != null) return `team:${authed.team.team_id}`;
    return ipKeyGenerator(req.ip ?? "unknown");
  },
});

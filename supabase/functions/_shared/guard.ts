/**
 * Pure policy logic for the AI parse proxy's day-one abuse/cost controls.
 *
 * This module is intentionally dependency-free (no Deno globals, no npm
 * imports) so it can be (a) imported by the Deno Edge Function at runtime and
 * (b) unit-tested in the plain-Node jest suite — the same "keep domain logic
 * framework-free" rule the rest of the repo follows.
 *
 * It does NOT talk to Redis itself. Storage is injected via the `RateStore`
 * interface (mirroring the CryptoProvider pattern in src/lib/crypto.ts): tests
 * inject an in-memory fake; the function injects an Upstash REST store.
 *
 * Three controls, all enforced *before* the (expensive) model call:
 *   1. Per-IP rate limit  — coarse flood protection (a fixed window / minute).
 *   2. Response cache      — identical inputs reuse a prior parse, for free.
 *   3. Per-user daily quota — fairness + the free/premium monetisation lever.
 *
 * The global, provider-level spend cap (Anthropic budget + Supabase usage cap)
 * is the ultimate denial-of-wallet backstop and lives in those dashboards — see
 * backend/README.md. These in-function controls reduce how often that ceiling
 * is ever approached; they are not a substitute for it.
 */

/** Minimal key/value store the controls need. Implemented by Upstash in prod. */
export interface RateStore {
  /**
   * Atomically increment the counter at `key`, returning the new value. When
   * the key is first created (new value === 1) it MUST be given `ttlSeconds` so
   * the window/quota expires on its own.
   */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Read a cached value, or null if absent/expired. */
  get(key: string): Promise<string | null>;
  /** Write a value with a TTL (seconds). */
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** Outcome of a rate-limit / quota check. */
export interface LimitDecision {
  allowed: boolean;
  /** The configured ceiling for this window. */
  limit: number;
  /** Requests remaining in the window after this one (never negative). */
  remaining: number;
  /** Seconds until the window resets — surfaced as Retry-After on a 429. */
  resetSeconds: number;
}

const DAY_SECONDS = 86_400;

/** Normalise free text so trivially-different inputs share a cache entry. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Small, fast, dependency-free string hash (FNV-1a, 32-bit) rendered base36.
 * Used only to keep cache keys short — not for any security purpose. We fold in
 * the input length to further reduce the already-low collision chance within a
 * short cache TTL.
 */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + input.length.toString(36);
}

/**
 * Build the cache signature from everything that shapes the model prompt — not
 * just the text. Two requests only share a cached parse when their text AND
 * their grounding context (currency, known categories/accounts/payees) match,
 * otherwise a cache hit could return a parse that mapped to the wrong entities.
 * Entity lists are sorted so ordering doesn't fragment the cache.
 */
export interface CacheInput {
  text: string;
  defaultCurrency?: string;
  categories?: string[];
  accounts?: string[];
  payees?: string[];
}

export function cacheSignature(input: CacheInput): string {
  const sortedJoin = (xs?: string[]) => (xs ? [...xs].sort().join(',') : '');
  return [
    normalizeText(input.text),
    (input.defaultCurrency ?? '').toUpperCase(),
    sortedJoin(input.categories),
    sortedJoin(input.accounts),
    sortedJoin(input.payees),
  ].join('|');
}

export function cacheKey(input: CacheInput): string {
  return `parse:cache:v1:${hashKey(cacheSignature(input))}`;
}

/** UTC day stamp (YYYY-MM-DD) for the daily quota key. */
export function dayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Seconds remaining until the next UTC midnight (daily quota reset). */
export function secondsUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const nextMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((nextMidnight - nowMs) / 1000));
}

export function quotaKey(userId: string, nowMs: number): string {
  return `parse:quota:${userId}:${dayStamp(nowMs)}`;
}

export function rateKey(ip: string, nowMs: number, windowSeconds: number): string {
  const bucket = Math.floor(nowMs / 1000 / windowSeconds);
  return `parse:rate:${windowSeconds}:${ip}:${bucket}`;
}

/** Turn a post-increment count into a decision against `limit`. */
export function decide(count: number, limit: number, resetSeconds: number): LimitDecision {
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds,
  };
}

/**
 * Per-IP fixed-window rate limit. Increments the current window's counter and
 * decides against `limitPerWindow`. Coarse by design — it stops floods without
 * needing per-user identity (so it also covers the brief window before auth).
 */
export async function consumeRateLimit(
  store: RateStore,
  ip: string,
  nowMs: number,
  limitPerWindow: number,
  windowSeconds: number
): Promise<LimitDecision> {
  const key = rateKey(ip, nowMs, windowSeconds);
  const count = await store.incr(key, windowSeconds);
  // Reset horizon = time left in the current fixed window.
  const elapsed = (nowMs / 1000) % windowSeconds;
  const resetSeconds = Math.max(1, Math.ceil(windowSeconds - elapsed));
  return decide(count, limitPerWindow, resetSeconds);
}

/**
 * Per-user daily quota. Only call this on a cache MISS — cached responses are
 * effectively free and should not burn a user's allowance.
 */
export async function consumeDailyQuota(
  store: RateStore,
  userId: string,
  nowMs: number,
  dailyLimit: number
): Promise<LimitDecision> {
  const key = quotaKey(userId, nowMs);
  const ttl = secondsUntilUtcMidnight(nowMs);
  const count = await store.incr(key, ttl);
  return decide(count, dailyLimit, ttl);
}

export { DAY_SECONDS };

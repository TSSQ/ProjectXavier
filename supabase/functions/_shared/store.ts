/**
 * Upstash Redis (REST) implementation of the RateStore interface from guard.ts.
 *
 * Upstash's REST API is a perfect fit for Deno Edge Functions — it's plain
 * HTTPS, no persistent TCP connection, no extra runtime. Configure via secrets:
 *   supabase secrets set UPSTASH_REDIS_REST_URL=https://<db>.upstash.io
 *   supabase secrets set UPSTASH_REDIS_REST_TOKEN=<token>
 *
 * If those secrets are absent we return a no-op store that fails OPEN (allows
 * every request). Rationale: the global provider spend caps (Anthropic budget +
 * Supabase usage cap, see backend/README.md) are the hard ceiling, so a missing
 * Redis should not take the whole feature down — but it IS logged so the misconfig
 * is visible. In production these secrets must be set.
 */
import { RateStore } from './guard.ts';

const REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL') ?? '';
const REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ?? '';

/** A store that allows everything — used when Redis isn't configured. */
const NOOP_STORE: RateStore = {
  async incr() {
    return 1; // count of 1 is always within any positive limit
  },
  async get() {
    return null; // never a cache hit
  },
  async setEx() {
    /* drop writes */
  },
};

/** One Upstash REST command, e.g. ['INCR', key]. Returns the `result` field. */
async function command(args: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Upstash error: ${body.error}`);
  return body.result ?? null;
}

const upstashStore: RateStore = {
  async incr(key, ttlSeconds) {
    const next = Number(await command(['INCR', key]));
    // Set the TTL only when the key was just created, so the window/quota
    // expires relative to its first request rather than being extended forever.
    if (next === 1) {
      await command(['EXPIRE', key, ttlSeconds]);
    }
    return next;
  },
  async get(key) {
    const v = await command(['GET', key]);
    return v == null ? null : String(v);
  },
  async setEx(key, value, ttlSeconds) {
    await command(['SET', key, value, 'EX', ttlSeconds]);
  },
};

/**
 * The store the function should use. Falls back to a fail-open no-op (with a
 * warning) when Upstash isn't configured.
 */
export function getStore(): RateStore {
  if (!REST_URL || !REST_TOKEN) {
    console.warn(
      '[parse] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting & quota ' +
        'are DISABLED (fail-open). Set them in production; the provider spend ' +
        'cap is the only remaining backstop.'
    );
    return NOOP_STORE;
  }
  return upstashStore;
}

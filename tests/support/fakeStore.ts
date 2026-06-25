/**
 * In-memory RateStore for the AI-guard tests. Mirrors the Upstash semantics the
 * Edge Function relies on: INCR creates the key at 1 and sets a TTL only on
 * first touch; expired keys read back as absent. Time is injected (no real
 * clocks) so window/quota expiry is deterministic.
 */
import { RateStore } from '../../supabase/functions/_shared/guard';

interface Entry {
  value: string;
  expiresAtMs: number;
}

export class FakeStore implements RateStore {
  private map = new Map<string, Entry>();
  /** Test-controlled clock (ms). Advance with `advance()`. */
  nowMs = 0;

  private live(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAtMs <= this.nowMs) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const e = this.live(key);
    if (!e) {
      // New window/quota: start at 1 and stamp the TTL.
      this.map.set(key, { value: '1', expiresAtMs: this.nowMs + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number(e.value) + 1;
    e.value = String(next);
    return next;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value, expiresAtMs: this.nowMs + ttlSeconds * 1000 });
  }

  /** Advance the injected clock by N seconds. */
  advance(seconds: number): void {
    this.nowMs += seconds * 1000;
  }
}

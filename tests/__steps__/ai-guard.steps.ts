import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  consumeDailyQuota,
  consumeRateLimit,
  cacheKey,
  LimitDecision,
} from '../../supabase/functions/_shared/guard';
import { FakeStore } from '../support/fakeStore';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/ai-guard.feature')
);

defineFeature(feature, (test) => {
  let store: FakeStore;
  let dailyLimit: number;
  let rateLimit: number;
  let windowSeconds: number;
  let decisions: LimitDecision[];
  let last: LimitDecision;
  let keyA: string;
  let keyB: string;

  const reset = () => {
    store = new FakeStore();
    // Fix the clock to a known UTC time mid-day so reset math is deterministic.
    store.nowMs = Date.UTC(2026, 5, 25, 9, 0, 0);
    decisions = [];
  };

  const makeUserRequests = async (userId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      decisions.push(await consumeDailyQuota(store, userId, store.nowMs, dailyLimit));
    }
  };

  test('A user may parse up to their daily quota', ({ given, when, then }) => {
    given(/^a daily quota of (\d+) parses$/, (n: string) => {
      reset();
      dailyLimit = Number(n);
    });
    when(/^user "(.*)" makes (\d+) parse requests in one day$/, async (u, n) => {
      await makeUserRequests(u, Number(n));
    });
    then(/^all (\d+) requests should be allowed$/, (n: string) => {
      expect(decisions).toHaveLength(Number(n));
      expect(decisions.every((d) => d.allowed)).toBe(true);
    });
  });

  test('The daily quota blocks the next request once exhausted', ({
    given,
    when,
    and,
    then,
  }) => {
    given(/^a daily quota of (\d+) parses$/, (n: string) => {
      reset();
      dailyLimit = Number(n);
    });
    when(/^user "(.*)" makes (\d+) parse requests in one day$/, async (u, n) => {
      await makeUserRequests(u, Number(n));
    });
    and(/^user "(.*)" makes 1 more parse request$/, async (u) => {
      last = await consumeDailyQuota(store, u, store.nowMs, dailyLimit);
    });
    then(/^that request should be blocked$/, () => {
      expect(last.allowed).toBe(false);
      expect(last.remaining).toBe(0);
    });
    and(/^the block should report a reset within 24 hours$/, () => {
      expect(last.resetSeconds).toBeGreaterThan(0);
      expect(last.resetSeconds).toBeLessThanOrEqual(86_400);
    });
  });

  test('The daily quota resets the next day', ({ given, when, and, then }) => {
    given(/^a daily quota of (\d+) parses$/, (n: string) => {
      reset();
      dailyLimit = Number(n);
    });
    when(/^user "(.*)" makes (\d+) parse requests in one day$/, async (u, n) => {
      await makeUserRequests(u, Number(n));
    });
    and(/^a new day begins$/, () => {
      store.advance(86_400);
    });
    and(/^user "(.*)" makes 1 more parse request$/, async (u) => {
      last = await consumeDailyQuota(store, u, store.nowMs, dailyLimit);
    });
    then(/^that request should be allowed$/, () => {
      expect(last.allowed).toBe(true);
    });
  });

  test('Quotas are tracked per user', ({ given, when, and, then }) => {
    given(/^a daily quota of (\d+) parses$/, (n: string) => {
      reset();
      dailyLimit = Number(n);
    });
    when(/^user "(.*)" makes (\d+) parse requests in one day$/, async (u, n) => {
      await makeUserRequests(u, Number(n));
    });
    and(/^user "(.*)" makes 1 parse request$/, async (u) => {
      last = await consumeDailyQuota(store, u, store.nowMs, dailyLimit);
    });
    then(/^user "(.*)"'s request should be allowed$/, () => {
      expect(last.allowed).toBe(true);
    });
  });

  test('The per-IP rate limit blocks a burst within the window', ({
    given,
    when,
    then,
  }) => {
    given(/^a rate limit of (\d+) requests per (\d+) seconds$/, (n, w) => {
      reset();
      rateLimit = Number(n);
      windowSeconds = Number(w);
    });
    when(/^IP "(.*)" makes (\d+) requests within the window$/, async (ip, n) => {
      for (let i = 0; i < Number(n); i++) {
        decisions.push(
          await consumeRateLimit(store, ip, store.nowMs, rateLimit, windowSeconds)
        );
      }
    });
    then(/^the first 2 should be allowed and the 3rd blocked$/, () => {
      expect(decisions[0]?.allowed).toBe(true);
      expect(decisions[1]?.allowed).toBe(true);
      expect(decisions[2]?.allowed).toBe(false);
    });
  });

  test('Identical inputs share a cache key, different context does not', ({
    when,
    then,
    and,
  }) => {
    when(
      /^I build cache keys for the same text with different default currencies$/,
      () => {
        keyA = cacheKey({ text: '12 lunch at Joe’s', defaultCurrency: 'SGD' });
        keyB = cacheKey({ text: '12 lunch at Joe’s', defaultCurrency: 'USD' });
      }
    );
    then(/^the two cache keys should differ$/, () => {
      expect(keyA).not.toBe(keyB);
    });
    and(/^reordering the known categories should not change the cache key$/, () => {
      const k1 = cacheKey({ text: 'coffee', categories: ['Food', 'Coffee'] });
      const k2 = cacheKey({ text: 'coffee', categories: ['Coffee', 'Food'] });
      expect(k1).toBe(k2);
    });
  });
});

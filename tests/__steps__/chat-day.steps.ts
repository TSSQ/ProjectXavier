import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ChatDayStore,
  ChatResetDecision,
  chatDayKey,
  clearNoticeOnMessage,
  chatResetTrigger,
  decideChatReset,
  runChatDayCheck,
} from '../../src/domain/chatDay';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-day.feature'));

/** Local-time epoch from "YYYY-MM-DD HH:MM" in the process's current zone. */
function local(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, mi).getTime();
}

function fakeStore(oldest: string | null, notice = false) {
  const state = { oldest, notice, writes: 0 };
  const store: ChatDayStore = {
    oldestDayKey: async () => state.oldest,
    clearAll: async () => {
      state.oldest = null;
    },
    getNotice: async () => state.notice,
    setNotice: async (on) => {
      state.writes += 1;
      state.notice = on;
    },
  };
  return { state, store };
}

defineFeature(feature, (test) => {
  let decision: ChatResetDecision;

  const expectReset = (day: string) => {
    expect(decision.reset).toBe(true);
    expect(decision.dayKey).toBe(day);
  };

  test('The day key is the local date, either side of midnight', ({ then }) => {
    then(
      /^2026-10-05 23:59 local is day "(.*)" and 2026-10-06 00:01 local is day "(.*)"$/,
      (before: string, after: string) => {
        expect(chatDayKey(local('2026-10-05', '23:59'))).toBe(before);
        expect(chatDayKey(local('2026-10-06', '00:01'))).toBe(after);
      }
    );
  });

  const launch = (
    when: (re: RegExp, fn: (...a: string[]) => void) => void,
    re: RegExp,
    unlocked: boolean
  ) =>
    when(re, (date: string, time: string, oldest: string) => {
      decision = decideChatReset({
        oldestStoredDayKey: oldest,
        now: local(date, time),
        trigger: chatResetTrigger({ kind: 'launch' }),
        unlocked,
      });
    });

  test('A cold launch on a new day resets', ({ when, then }) => {
    launch(when, /^the app cold-launches at (\S+) (\S+) with the oldest stored message from "(.*)"$/, true);
    then(/^the chat should reset for day "(.*)"$/, expectReset);
  });

  test('A cold launch on the same day does not reset', ({ when, then }) => {
    launch(when, /^the app cold-launches at (\S+) (\S+) with the oldest stored message from "(.*)"$/, true);
    then('the chat should not reset', () => expect(decision.reset).toBe(false));
  });

  test('Resuming from the background across midnight resets', ({ when, then }) => {
    when(
      /^the app becomes active from background at (\S+) (\S+) with the oldest stored message from "(.*)"$/,
      (date: string, time: string, oldest: string) => {
        decision = decideChatReset({
          oldestStoredDayKey: oldest,
          now: local(date, time),
          trigger: chatResetTrigger({ kind: 'app_state', from: 'background', to: 'active' }),
          unlocked: true,
        });
      }
    );
    then(/^the chat should reset for day "(.*)"$/, expectReset);
  });

  test('A session that runs past midnight does not reset', ({ given, when, then }) => {
    let started = '';
    given(/^a session that started on "(.*)"$/, (day: string) => {
      started = day;
    });
    when('midnight passes with only a timer tick and an inactive to active blip', () => {
      const after = local('2026-10-06', '00:05');
      const timer = chatResetTrigger({ kind: 'timer' });
      const blip = chatResetTrigger({ kind: 'app_state', from: 'inactive', to: 'active' });
      const results = [timer, blip].map((trigger) =>
        decideChatReset({ oldestStoredDayKey: started, now: after, trigger, unlocked: true })
      );
      decision = results.find((r) => r.reset) ?? results[0]!;
    });
    then('the chat should not reset', () => expect(decision.reset).toBe(false));
  });

  test('A locked app never resets', ({ when, then }) => {
    launch(
      when,
      /^the app cold-launches at (\S+) (\S+) while locked with the oldest stored message from "(.*)"$/,
      false
    );
    then('the chat should not reset', () => expect(decision.reset).toBe(false));
  });

  test('An empty chat never resets', ({ when, then }) => {
    when(/^the app cold-launches at (\S+) (\S+) with nothing stored$/, (date: string, time: string) => {
      decision = decideChatReset({
        oldestStoredDayKey: null,
        now: local(date, time),
        trigger: 'cold_launch',
        unlocked: true,
      });
    });
    then('the chat should not reset', () => expect(decision.reset).toBe(false));
  });

  test("The oldest stored day decides, so leftovers from a session past midnight reset", ({ when, then }) => {
    when(
      /^the app becomes active from background at (\S+) (\S+) with the oldest stored message from "(.*)"$/,
      (date: string, time: string, oldest: string) => {
        decision = decideChatReset({
          oldestStoredDayKey: oldest,
          now: local(date, time),
          trigger: 'resume',
          unlocked: true,
        });
      }
    );
    then(/^the chat should reset for day "(.*)"$/, expectReset);
  });

  test('Only a launch and a background resume are triggers', ({ then }) => {
    then(
      'the lifecycle triggers should be cold_launch, resume, and nothing for a timer or an inactive blip',
      () => {
        expect(chatResetTrigger({ kind: 'launch' })).toBe('cold_launch');
        expect(chatResetTrigger({ kind: 'app_state', from: 'background', to: 'active' })).toBe('resume');
        expect(chatResetTrigger({ kind: 'timer' })).toBeNull();
        expect(chatResetTrigger({ kind: 'app_state', from: 'inactive', to: 'active' })).toBeNull();
        expect(chatResetTrigger({ kind: 'app_state', from: 'active', to: 'background' })).toBeNull();
        expect(chatResetTrigger({ kind: 'app_state', from: 'active', to: 'inactive' })).toBeNull();
      }
    );
  });

  // Runs under the device's zone: the default (UTC) and, via `npm run test:tz`,
  // America/New_York and Pacific/Auckland. Jest sandboxes process.env, so the
  // zone cannot be switched mid-test; the expectation is computed from the
  // zone's own offset instead.
  test('A time zone change moves the day key with the clock', ({ when, then }) => {
    let instant = 0;
    when(
      /^a message was stored under the date "(.*)" and the app cold-launches at the instant (\S+) in the device's zone$/,
      (storedKey: string, iso: string) => {
        instant = new Date(iso).getTime();
        decision = decideChatReset({
          oldestStoredDayKey: storedKey,
          now: instant,
          trigger: 'cold_launch',
          unlocked: true,
        });
      }
    );
    then(
      /^the chat should reset exactly when the device's local date at that instant is not "(.*)"$/,
      (storedKey: string) => {
        const shifted = new Date(instant - new Date(instant).getTimezoneOffset() * 60_000);
        const localDate = shifted.toISOString().slice(0, 10);
        expect(decision.dayKey).toBe(localDate);
        expect(decision.reset).toBe(localDate !== storedKey);
      }
    );
  });

  /** Local days of 2026 whose length is not 24h in the running zone. */
  function transitionDays(): Array<[number, number, number]> {
    const days: Array<[number, number, number]> = [];
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const here = new Date(2026, m, d);
        if (here.getMonth() !== m) continue;
        const next = new Date(2026, m, d + 1);
        if (next.getTime() - here.getTime() !== 86_400_000) days.push([2026, m, d]);
      }
    }
    return days;
  }

  test('Daylight saving never skips or repeats a day', ({ then }) => {
    then(
      /^every half hour of each 2026 daylight-saving transition day in the running zone has a single day key, and the next day differs$/,
      () => {
        const days = transitionDays();
        // Pin that the zone-pinned runs really cross transitions (not vacuous).
        if (process.env.TZ === 'America/New_York' || process.env.TZ === 'Pacific/Auckland') {
          expect(days).toHaveLength(2);
        }
        for (const [y, m, d] of days) {
          const start = new Date(y, m, d).getTime();
          const expected = chatDayKey(start);
          const next = chatDayKey(new Date(y, m, d + 1).getTime());
          expect(next).not.toBe(expected);
          const seen = new Set<string>();
          for (let t = start; t < start + 26 * 3_600_000; t += 1_800_000) {
            const key = chatDayKey(t);
            if (key === next) break;
            seen.add(key);
          }
          expect([...seen]).toEqual([expected]);
          // The day's last half hour and the next day's first are still on their own days.
          expect(chatDayKey(new Date(y, m, d, 23, 30).getTime())).toBe(expected);
          expect(chatDayKey(new Date(y, m, d + 1, 0, 30).getTime())).toBe(next);
        }
        if (days.length === 0) {
          // No DST here: the guarantee reduces to a constant offset all year.
          const offsets = new Set([0, 2, 5, 8, 11].map((m) => new Date(2026, m, 15).getTimezoneOffset()));
          expect(offsets.size).toBe(1);
        }
      }
    );
  });

  test('A reset arms the one-time note and a later open clears it', ({ given, when, then }) => {
    let ctx = fakeStore("2026-10-05");
    const now = local('2026-10-06', '08:00');
    given("a chat store holding yesterday's messages", () => {
      ctx = fakeStore('2026-10-05');
    });
    when('the app cold-launches today after unlock', async () => {
      await runChatDayCheck(ctx.store, { now, trigger: 'cold_launch', unlocked: true });
    });
    then('the store should be empty and the notice should be on', () => {
      expect(ctx.state).toMatchObject({ oldest: null, notice: true });
    });
    when('the app becomes active from background the same day', async () => {
      await runChatDayCheck(ctx.store, { now: now + 3_600_000, trigger: 'resume', unlocked: true });
    });
    then('the notice should be off', () => expect(ctx.state.notice).toBe(false));
  });

  test('The first message clears an armed note', ({ given, when, and, then }) => {
    let ctx = fakeStore('2026-10-05');
    given("a chat store holding yesterday's messages", () => {
      ctx = fakeStore('2026-10-05');
    });
    when('the app cold-launches today after unlock', async () => {
      await runChatDayCheck(ctx.store, {
        now: local('2026-10-06', '08:00'),
        trigger: 'cold_launch',
        unlocked: true,
      });
    });
    and('the first message of the day is sent', async () => {
      await clearNoticeOnMessage(ctx.store);
    });
    then('the notice should be off', () => expect(ctx.state.notice).toBe(false));
  });

  test('The first message is a no-op when no note is armed', ({ given, when, then }) => {
    let ctx = fakeStore(null);
    given('a chat store with the notice off', () => {
      ctx = fakeStore(null, false);
    });
    when('the first message of the day is sent', async () => {
      await clearNoticeOnMessage(ctx.store);
    });
    then('the notice should be off and nothing was written', () => {
      expect(ctx.state.notice).toBe(false);
      expect(ctx.state.writes).toBe(0);
    });
  });

  test('A locked or timer check leaves an armed note alone', ({ given, when, and, then }) => {
    let ctx = fakeStore('2026-10-05');
    const now = local('2026-10-06', '08:00');
    let writesAfterReset = 0;
    given("a chat store holding yesterday's messages", () => {
      ctx = fakeStore('2026-10-05');
    });
    when('the app cold-launches today after unlock', async () => {
      await runChatDayCheck(ctx.store, { now, trigger: 'cold_launch', unlocked: true });
      writesAfterReset = ctx.state.writes;
    });
    and('a locked resume and a timer tick happen the same day', async () => {
      await runChatDayCheck(ctx.store, { now: now + 1000, trigger: 'resume', unlocked: false });
      await runChatDayCheck(ctx.store, { now: now + 2000, trigger: chatResetTrigger({ kind: 'timer' }), unlocked: true });
    });
    then('the notice should be on and nothing was written', () => {
      expect(ctx.state.notice).toBe(true);
      expect(ctx.state.writes).toBe(writesAfterReset);
    });
    when('the app becomes active from background the same day', async () => {
      await runChatDayCheck(ctx.store, { now: now + 3_600_000, trigger: 'resume', unlocked: true });
    });
    then('the notice should be off', () => expect(ctx.state.notice).toBe(false));
  });
});

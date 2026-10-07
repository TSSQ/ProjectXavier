import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ChatCheckGate,
  ChatDayStore,
  ChatResetDecision,
  INITIAL_CHAT_CHECK_GATE,
  chatCheckGateReduce,
  chatDayKey,
  runChatDayCheck,
} from '../../src/domain/chatDay';
import {
  LayoutPhase,
  layoutPhaseReduce,
  shouldClearNoteOnPhase,
  showResetNote,
} from '../../src/domain/chatFeed';
import { createChatRecorder } from '../../src/domain/chatRecorder';
import { textBubble } from '../../src/domain/bubbleCopy';
import { notifyChatRestored, subscribeChatRestored } from '../../src/domain/chatRestoreSignal';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-day-lifecycle.feature'));

const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();

function recorder(dayKey = '2026-10-05') {
  let n = 0;
  const rec = createChatRecorder({
    newId: () => `id-${++n}`,
    now: () => at(5, 10),
    idleGreeting: 'Hi',
    warn: () => undefined,
    onChange: () => undefined,
  });
  rec.load([], 1, dayKey);
  return rec;
}

defineFeature(feature, (test) => {
  // ── the gate ──
  let gate: ChatCheckGate = INITIAL_CHAT_CHECK_GATE;
  let runs: Array<string | null> = [];
  const feed = (...states: string[]) => {
    for (const to of states) {
      const step = chatCheckGateReduce(gate, to);
      gate = step.gate;
      if (step.run) runs.push(step.run);
    }
  };
  const freshGate = () => {
    gate = INITIAL_CHAT_CHECK_GATE;
    runs = [];
  };
  const backgroundAndBack = () => feed('background', 'active');

  test('Returning from the background runs one resume check', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app goes to the background and becomes active again', backgroundAndBack);
    then('one resume check should run', () => expect(runs).toEqual(['resume']));
  });

  test('The lock state does not matter and a resume runs exactly once', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app goes to the background and becomes active again, then reports active twice more', () =>
      feed('background', 'active', 'active', 'active')
    );
    then('one resume check should run', () => expect(runs).toEqual(['resume']));
  });

  test('The iOS inactive hops on the way do not hide the background visit', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app goes inactive, to the background, inactive, then active', () =>
      feed('inactive', 'background', 'inactive', 'active')
    );
    then('one resume check should run', () => expect(runs).toEqual(['resume']));
  });

  test('The Face ID sheet is only an inactive blip', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app goes inactive and active again', () => feed('inactive', 'active'));
    then('no check should run', () => expect(runs).toEqual([]));
  });

  test('Being active at the start is not a resume', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app reports active before ever leaving', () => feed('active'));
    then('no check should run', () => expect(runs).toEqual([]));
  });

  test('A session running past midnight is not checked without leaving the app', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('time passes with no lifecycle event', () => feed());
    then('no check should run', () => expect(runs).toEqual([]));
  });

  test('Each resume runs its own check', ({ given, when, then }) => {
    given('a fresh check gate', freshGate);
    when('the app goes to the background and becomes active again', backgroundAndBack);
    when('the app goes to the background and becomes active again', backgroundAndBack);
    then('two resume checks should have run', () => expect(runs).toEqual(['resume', 'resume']));
  });

  test('Every 23:30 to 00:30 resume crosses to the next local day, daylight saving included', ({ then }) => {
    then('for every day of 2026 a resume from 23:30 to 00:30 sees the next local date', () => {
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      for (let day = 0; day < 365; day += 1) {
        const evening = new Date(2026, 0, 1 + day, 23, 30);
        const after = new Date(2026, 0, 2 + day, 0, 30);
        expect(chatDayKey(evening.getTime())).toBe(dateOf(evening));
        expect(chatDayKey(after.getTime())).toBe(dateOf(after));
        expect(chatDayKey(after.getTime())).not.toBe(chatDayKey(evening.getTime()));
      }
    });
  });

  // ── the check against a store ──
  let stored = { oldest: null as string | null, notice: false };
  let failNote = false;
  let failClear = false;
  const store = (): ChatDayStore => ({
    oldestDayKey: async () => stored.oldest,
    clearAll: async () => {
      if (failClear) throw new Error('disk full');
      stored.oldest = null;
    },
    getNotice: async () => stored.notice,
    setNotice: async (on) => {
      if (failNote) throw new Error('disk full');
      stored.notice = on;
    },
  });
  let outcome: ChatResetDecision | 'threw' | null = null;
  const coldLaunch = async () => {
    try {
      outcome = await runChatDayCheck(store(), { now: at(6, 7), trigger: 'cold_launch' });
    } catch {
      outcome = 'threw';
    }
  };

  test('A day check whose note write fails still reports the clear', ({ given, when, then }) => {
    given("a chat store holding yesterday's messages whose note cannot be written", () => {
      stored = { oldest: '2026-10-05', notice: false };
      failNote = true;
      failClear = false;
    });
    when('the app cold-launches today after unlock', coldLaunch);
    then('the check should report a reset and the store should be empty', () => {
      expect(outcome).toMatchObject({ reset: true, dayKey: '2026-10-06' });
      expect(stored.oldest).toBeNull();
    });
  });

  test('A day check whose clear fails reports the failure and leaves the note alone', ({ given, when, then }) => {
    given("a chat store holding yesterday's messages that cannot be cleared", () => {
      stored = { oldest: '2026-10-05', notice: false };
      failNote = false;
      failClear = true;
    });
    when('the app cold-launches today after unlock', coldLaunch);
    then('the check should fail and the notice should be off', () => {
      expect(outcome).toBe('threw');
      expect(stored).toEqual({ oldest: '2026-10-05', notice: false });
    });
  });

  // ── the note, walked through the layout ──
  let armed = false;
  let seen: string[] = [];
  let clears = 0;
  const walk = () => {
    let phase: LayoutPhase = 'loading';
    seen = [];
    clears = 0;
    const step = (event: Parameters<typeof layoutPhaseReduce>[1]) => {
      const next = layoutPhaseReduce(phase, event);
      if (shouldClearNoteOnPhase(phase, next)) clears += 1;
      phase = next;
      seen.push(`${phase}:${showResetNote(armed, phase)}`);
    };
    step({ type: 'loaded', quiet: true });
    step({ type: 'notQuiet' });
    step({ type: 'moveFinished' });
  };

  test('The hero note is shown until the first message and cleared exactly once', ({ given, when, then }) => {
    given('a day that reset with the note armed', () => {
      armed = true;
    });
    when('the layout walks from loading through the first message to the header', walk);
    then(
      'the note is shown in the hero and while moving, never in the header, and the stored note is cleared once on the first message',
      () => {
        expect(seen).toEqual(['hero:true', 'moving:true', 'header:false']);
        expect(clears).toBe(1);
      }
    );
  });

  test('A disarmed note is never shown', ({ given, when, then }) => {
    given('a day that reset with the note disarmed', () => {
      armed = false;
    });
    when('the layout walks from loading through the first message to the header', walk);
    then('the note is never shown', () => {
      expect(seen).toEqual(['hero:false', 'moving:false', 'header:false']);
    });
  });

  // ── the recorder ──
  let rec = recorder();
  const withYesterdaysChat = () => {
    rec = recorder('2026-10-05');
    rec.recordUser('old news');
    rec.recordXavier(textBubble('Old reply.'));
    expect(rec.state().messages).toHaveLength(2);
  };
  const onlyTheNewMessage = () => {
    expect(rec.state().messages.map((m) => [m.kind, m.dayKey, m.seq])).toEqual([
      ['user_text', '2026-10-06', 1],
    ]);
  };

  test('A late result from a parse that was running at the reset is dropped', ({ given, when, then }) => {
    given('a loaded recorder with a parse running', () => {
      rec = recorder('2026-10-05');
    });
    when(
      /^the chat resets for "(.*)" with that parse still running and its result arrives$/,
      (day: string) => {
        rec.reset(day, { fence: true });
        rec.recordXavier(textBubble('Logged lunch.'), { logged: true });
      }
    );
    then('the new day should stay empty', () => expect(rec.state().messages).toEqual([]));
    when('the parse has finished and a new message is recorded', () => {
      rec.unfence();
      rec.recordUser('fresh start');
    });
    then('only the new message should be on the new day', onlyTheNewMessage);
  });

  test('A reset with nothing running does not fence the log', ({ given, when, then }) => {
    given('a loaded recorder with a parse running', () => {
      rec = recorder('2026-10-05');
    });
    when(/^the chat resets for "(.*)" with nothing running and a message is recorded$/, (day: string) => {
      rec.reset(day);
      rec.recordUser('fresh start');
    });
    then('only the new message should be on the new day', () => {
      expect(rec.isFenced()).toBe(false);
      onlyTheNewMessage();
    });
  });

  test('Calls made while a day check is held replay under the day it decided', ({ given, when, then }) => {
    given("a loaded recorder holding yesterday's chat", withYesterdaysChat);
    when(
      /^the log is held, a message is recorded, the chat resets for "(.*)" and the hold is released$/,
      (day: string) => {
        rec.hold();
        rec.recordUser('fresh start');
        expect(rec.state().messages).toHaveLength(2);
        rec.reset(day);
        rec.release();
      }
    );
    then('only the new message should be on the new day', onlyTheNewMessage);
  });

  test('An empty chat left open past midnight adopts the new day', ({ given, when, then }) => {
    given(/^a loaded recorder on "(.*)" with an empty chat$/, (day: string) => {
      rec = recorder(day);
    });
    when(/^the day check finds nothing to clear on "(.*)" and a message follows$/, (day: string) => {
      rec.adoptDayIfEmpty(day);
      rec.recordUser('hello');
    });
    then(/^the message should carry "(.*)"$/, (day: string) => {
      expect(rec.state().messages.map((m) => m.dayKey)).toEqual([day]);
    });
  });

  test('A chat with messages keeps its day when nothing was cleared', ({ given, when, then }) => {
    given(/^a loaded recorder on "(.*)" with one message$/, (day: string) => {
      rec = recorder(day);
      rec.recordUser('first');
    });
    when(/^the day check finds nothing to clear on "(.*)" and a message follows$/, (day: string) => {
      expect(rec.adoptDayIfEmpty(day)).toBe(false);
      rec.recordUser('second');
    });
    then(/^both messages should carry "(.*)"$/, (day: string) => {
      expect(rec.state().messages.map((m) => m.dayKey)).toEqual([day, day]);
    });
  });

  test('A restore signal reaches every listener until it is removed', ({ given, when, then }) => {
    const calls = { first: 0, second: 0 };
    let off = () => undefined as void;
    let offSecond = () => undefined as void;
    given('two listeners on the restore signal, one of which throws', () => {
      off = subscribeChatRestored(() => {
        calls.first += 1;
        throw new Error('boom');
      });
      offSecond = subscribeChatRestored(() => {
        calls.second += 1;
      });
    });
    when('a restore completes', () => notifyChatRestored());
    then('both listeners should have been called', () => expect(calls).toEqual({ first: 1, second: 1 }));
    when('the first listener is removed and another restore completes', () => {
      off();
      notifyChatRestored();
    });
    then('only the second listener should have been called again', () => {
      expect(calls).toEqual({ first: 1, second: 2 });
      offSecond();
    });
  });
});

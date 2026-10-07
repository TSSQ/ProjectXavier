import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { ChatDayStore, runChatDayCheck } from '../../src/domain/chatDay';
import { ChatSession, HOLD_TIMEOUT_MS, createChatChain, createChatSession } from '../../src/domain/chatSession';
import { createChatRecorder } from '../../src/domain/chatRecorder';
import { textBubble } from '../../src/domain/bubbleCopy';
import { ChatMessage } from '../../src/domain/chatMessage';
import { notifyChatRestored, subscribeChatRestored } from '../../src/domain/chatRestoreSignal';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-day-session.feature'));

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

interface Deferred {
  promise: Promise<void>;
  open: () => void;
}
const deferred = (): Deferred => {
  let open = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

let seedN = 0;
function seed(dayKey: string, text = 'old news'): ChatMessage[] {
  const r = createChatRecorder({
    newId: () => `seed-${++seedN}`,
    now: () => 0,
    idleGreeting: 'Hi',
    warn: () => undefined,
    onChange: () => undefined,
  });
  r.load([], 1, dayKey);
  r.recordUser(text);
  return r.state().messages;
}

/** The fake world one app launch runs in: a database, a clock and the knobs tests turn. */
function newWorld() {
  return {
    db: [] as ChatMessage[],
    noticeFlag: false,
    clock: { t: at(5, 10) },
    busy: false,
    launchDone: false,
    checkTriggers: [] as string[],
    failChecks: 0,
    checkGate: null as Deferred | null,
    listGate: null as Deferred | null,
    appendGate: null as Deferred | null,
    warns: [] as string[],
    held: [] as boolean[],
    notice: [] as boolean[],
    epochs: 0,
    loaded: false,
    dayKeys: [] as string[],
    timers: [] as Array<{ fn: () => void; ms: number; cleared: boolean }>,
    chain: createChatChain(),
  };
}

defineFeature(feature, (test) => {
  let w = newWorld();
  let session: ChatSession;

  const store = (): ChatDayStore => ({
    oldestDayKey: async () => w.db.reduce<string | null>((min, m) => (min === null || m.dayKey < min ? m.dayKey : min), null),
    clearAll: async () => {
      w.db = [];
    },
    getNotice: async () => w.noticeFlag,
    setNotice: async (on) => {
      w.noticeFlag = on;
    },
  });

  const make = (): ChatSession => {
    // Only one screen listens to the process-wide restore signal at a time.
    session?.dispose();
    let n = 0;
    const s = createChatSession({
      chain: w.chain,
      now: () => w.clock.t,
      newId: () => `m-${++seedN}-${++n}`,
      idleGreeting: 'Hi',
      isBusy: () => w.busy,
      warn: (code) => w.warns.push(code),
      checkDay: async (input) => {
        w.checkTriggers.push(input.trigger);
        if (w.failChecks > 0) {
          w.failChecks -= 1;
          throw new Error('db unavailable');
        }
        if (w.checkGate) await w.checkGate.promise;
        return runChatDayCheck(store(), input);
      },
      listDay: async (dayKey) => {
        if (w.listGate) await w.listGate.promise;
        return w.db.filter((m) => m.dayKey === dayKey);
      },
      getRevision: async () => 1,
      getStoredNotice: async () => w.noticeFlag,
      clearStoredNotice: async () => {
        w.noticeFlag = false;
      },
      clearAll: async () => {
        w.db = [];
      },
      timers: {
        set: (fn, ms) => {
          const timer = { fn, ms, cleared: false };
          w.timers.push(timer);
          return timer;
        },
        clear: (handle) => {
          (handle as { cleared: boolean }).cleared = true;
        },
      },
      appendMessage: async (m) => {
        const gate = w.appendGate;
        w.appendGate = null;
        if (gate) await gate.promise;
        w.db.push(m);
      },
      updateContent: async () => undefined,
      setStatus: async () => undefined,
      launch: { done: () => w.launchDone, markDone: () => { w.launchDone = true; } },
      subscribeRestored: subscribeChatRestored,
      publish: {
        state: () => undefined,
        dayKey: (k) => w.dayKeys.push(k),
        notice: (on) => w.notice.push(on),
        held: (on) => w.held.push(on),
        loaded: () => { w.loaded = true; },
        epoch: () => { w.epochs += 1; },
      },
    });
    return s;
  };

  const start = async () => {
    session = make();
    await session.start();
    await session.settled();
  };
  const switchApp = async () => {
    session.onAppState('background');
    session.onAppState('active');
    await session.settled();
  };
  const lastNotice = () => w.notice[w.notice.length - 1];
  const messages = () => session.recorder.state().messages;
  const dbKeys = () => w.db.map((m) => m.dayKey);

  const yesterdaysChat = () => {
    w = newWorld();
    w.clock.t = at(6, 7);
    w.db = seed('2026-10-05');
  };
  const todaysChat = () => {
    w = newWorld();
    w.clock.t = at(5, 10);
    w.db = seed('2026-10-05');
  };
  const startedOnFifth = (withChat: boolean) => async () => {
    w = newWorld();
    w.clock.t = at(5, 10);
    w.db = withChat ? seed('2026-10-05') : [];
    await start();
  };

  test('A cold launch on a new day clears the old chat and arms the note', ({ given, when, then }) => {
    given("a database holding yesterday's chat", yesterdaysChat);
    when('the screen starts today', start);
    then('the log should be empty and loaded, the database empty, and the note armed', () => {
      expect(w.loaded).toBe(true);
      expect(messages()).toEqual([]);
      expect(w.db).toEqual([]);
      expect(lastNotice()).toBe(true);
    });
  });

  test('A cold launch on the same day keeps the chat and shows no note', ({ given, when, then }) => {
    given("a database holding today's chat", todaysChat);
    when('the screen starts today', start);
    then("the log should hold today's messages and the note should be off", () => {
      expect(messages()).toHaveLength(1);
      expect(w.db).toHaveLength(1);
      expect(lastNotice()).toBe(false);
    });
  });

  test('A remount reads the armed note back from the stored flag', ({ given, when, and, then }) => {
    given("a database holding yesterday's chat", yesterdaysChat);
    when('the screen starts today', start);
    and('the screen is closed and started again the same launch', async () => {
      session.dispose();
      await start();
    });
    then('the note should be armed and the check should have run once', () => {
      expect(lastNotice()).toBe(true);
      expect(w.checkTriggers).toEqual(['cold_launch']);
    });
  });

  test('A cold-launch check that throws is retried once the day has loaded', ({ given, when, then }) => {
    given("a database holding yesterday's chat whose first check throws", () => {
      yesterdaysChat();
      w.failChecks = 1;
    });
    when('the screen starts today', start);
    then(
      'the day should have loaded, a failure should be logged, the check should have run twice, and the chat should be cleared',
      () => {
        expect(w.loaded).toBe(true);
        expect(w.warns).toContain('chat_day_check_failed');
        expect(w.checkTriggers).toEqual(['cold_launch', 'cold_launch']);
        expect(w.db).toEqual([]);
        expect(w.launchDone).toBe(true);
      }
    );
  });

  test('A check that keeps failing is retried on the next resume', ({ given, when, and, then }) => {
    given("a database holding yesterday's chat whose first two checks throw", () => {
      yesterdaysChat();
      w.failChecks = 2;
    });
    when('the screen starts today', start);
    and('the app goes to the background and returns', switchApp);
    then('the check should have run three times and the launch check should be done', () => {
      expect(w.checkTriggers).toEqual(['cold_launch', 'cold_launch', 'resume']);
      expect(w.launchDone).toBe(true);
      expect(w.db).toEqual([]);
    });
  });

  test('A resume across midnight resets behind a held feed', ({ given, when, then, and }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the app goes to the background and returns', async () => {
      w.clock.t = at(6, 7);
      await switchApp();
    });
    then('the feed should have been held during the check and released after', () => {
      expect(w.held).toEqual([true, false]);
    });
    and('the log should be empty, the database empty, the note armed and the layout reset once', () => {
      expect(messages()).toEqual([]);
      expect(w.db).toEqual([]);
      expect(lastNotice()).toBe(true);
      expect(w.epochs).toBe(1);
    });
  });

  test('An ordinary same-day resume never holds the feed', ({ given, when, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the app goes to the background and returns', switchApp);
    then('the feed should never have been held and nothing should have been cleared', () => {
      expect(w.held).toEqual([]);
      expect(w.epochs).toBe(0);
      expect(messages()).toHaveLength(1);
      expect(w.db).toHaveLength(1);
    });
  });

  test('A message sent while the check is in flight survives under the new day', ({ given, when, and, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when(
      'the clock moves to the 6th, the app returns, and a message is sent while the check is still running',
      () => {
        w.clock.t = at(6, 7);
        w.checkGate = deferred();
        session.onAppState('background');
        session.onAppState('active');
        session.recorder.recordUser('hello from the new day');
        // Held: nothing is shown or written under the old day while the check runs.
        expect(messages()).toHaveLength(1);
      }
    );
    and('the check completes', async () => {
      w.checkGate!.open();
      await session.settled();
    });
    then(
      'the database should hold only that message, under the day "2026-10-06", and the log should show it',
      () => {
        expect(dbKeys()).toEqual(['2026-10-06']);
        expect(messages().map((m) => [m.dayKey, m.seq])).toEqual([['2026-10-06', 1]]);
      }
    );
  });

  test('No row survives a restore, even one whose write was blocked behind it', ({ given, when, then }) => {
    given('a screen that started on the 5th with an empty chat', startedOnFifth(false));
    when('two messages are sent while the first write is still running and a restore completes', async () => {
      w.appendGate = deferred();
      const gate = w.appendGate;
      session.recorder.recordUser('first');
      session.recorder.recordUser('second');
      await Promise.resolve();
      notifyChatRestored();
      gate.open();
      await session.settled();
    });
    then('the database should be empty and the log should be empty', () => {
      expect(w.db).toEqual([]);
      expect(messages()).toEqual([]);
    });
  });

  test('Resetting while a parse is running fences it until it finishes', ({ given, when, then }) => {
    given('a screen that started on the 5th with a chat and a parse running', async () => {
      await startedOnFifth(true)();
      w.busy = true;
    });
    when('the clock moves to the 6th and the app goes to the background and returns', async () => {
      w.clock.t = at(6, 7);
      await switchApp();
    });
    then('the late result should be dropped', async () => {
      expect(session.recorder.isFenced()).toBe(true);
      session.recorder.recordXavier(textBubble('Logged lunch.'), { logged: true });
      await session.settled();
      expect(messages()).toEqual([]);
      expect(w.db).toEqual([]);
    });
    when('the parse finishes and a message is sent', async () => {
      w.busy = false;
      session.recorder.unfence();
      session.recorder.recordUser('fresh start');
      await session.settled();
    });
    then('the database should hold only that message, under the day "2026-10-06"', () => {
      expect(dbKeys()).toEqual(['2026-10-06']);
    });
  });

  test('A restore while a parse is running fences it and disarms the note', ({ given, when, then }) => {
    given('a screen that started on the 6th after a reset with a parse running', async () => {
      yesterdaysChat();
      await start();
      expect(lastNotice()).toBe(true);
      w.busy = true;
    });
    when('a restore completes', () => notifyChatRestored());
    then('the late result should be dropped, the note should be off and the layout reset', async () => {
      session.recorder.recordXavier(textBubble('Logged lunch.'), { logged: true });
      await session.settled();
      expect(messages()).toEqual([]);
      expect(w.db).toEqual([]);
      expect(lastNotice()).toBe(false);
      expect(w.epochs).toBe(1);
    });
  });

  test('A resume that arrives before the day has loaded is checked once it has', ({ given, when, and, then }) => {
    let starting: Promise<void> = Promise.resolve();
    given("a database holding today's chat whose load is slow", () => {
      todaysChat();
      w.listGate = deferred();
    });
    when('the screen starts today and the app goes to the background and returns before the load lands', async () => {
      session = make();
      starting = session.start();
      await Promise.resolve();
      session.onAppState('background');
      session.onAppState('active');
      expect(w.loaded).toBe(false);
    });
    and('the load lands', async () => {
      w.listGate!.open();
      await starting;
      await session.settled();
    });
    then('the check should have run twice', () => {
      expect(w.checkTriggers).toEqual(['cold_launch', 'resume']);
      expect(w.loaded).toBe(true);
    });
  });

  test('Two resumes in a row each get a check', ({ given, when, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the app goes to the background and returns twice', async () => {
      w.clock.t = at(6, 7);
      session.onAppState('background');
      session.onAppState('active');
      session.onAppState('background');
      session.onAppState('active');
      await session.settled();
    });
    then('the check should have run three times and the layout should have reset once', () => {
      expect(w.checkTriggers).toEqual(['cold_launch', 'resume', 'resume']);
      expect(w.epochs).toBe(1);
      expect(w.held[w.held.length - 1]).toBe(false);
      expect(messages()).toEqual([]);
    });
  });

  test('An app switch before the first message disarms the note', ({ given, when, and, then }) => {
    given("a database holding yesterday's chat", yesterdaysChat);
    when('the screen starts today', start);
    and('the app goes to the background and returns', switchApp);
    then('the note should be off', () => {
      expect(lastNotice()).toBe(false);
      expect(w.noticeFlag).toBe(false);
    });
  });

  test('An empty chat left open past midnight stamps the next message with the new day', ({ given, when, then }) => {
    given('a screen that started on the 5th with an empty chat', startedOnFifth(false));
    when('the clock moves to the 6th, the app goes to the background and returns, and a message is sent', async () => {
      w.clock.t = at(6, 7);
      await switchApp();
      session.recorder.recordUser('good morning');
      await session.settled();
    });
    then('the database should hold only that message, under the day "2026-10-06"', () => {
      expect(dbKeys()).toEqual(['2026-10-06']);
    });
  });

  test('A session that crosses midnight keeps one day and is wiped on the next open', ({ given, when, then, and }) => {
    let keysBefore: string[] = [];
    given('a screen that started on the 5th at 23:50 with an empty chat', async () => {
      w = newWorld();
      w.clock.t = at(5, 23, 50);
      await start();
    });
    when(
      'a message is sent, midnight passes, another message is sent, and the screen is reopened on the 6th',
      async () => {
        session.recorder.recordUser('before midnight');
        await session.settled();
        w.clock.t = at(6, 0, 20);
        session.recorder.recordUser('after midnight');
        await session.settled();
        keysBefore = dbKeys();
        session.dispose();
        // A new app launch on the 6th, same database.
        const db = w.db;
        const noticeFlag = w.noticeFlag;
        w = newWorld();
        w.db = db;
        w.noticeFlag = noticeFlag;
        w.clock.t = at(6, 7);
        await start();
      }
    );
    then('both messages carried "2026-10-05" before the reopen', () => {
      expect(keysBefore).toEqual(['2026-10-05', '2026-10-05']);
    });
    and('after the reopen the database should be empty and the note armed', () => {
      expect(w.db).toEqual([]);
      expect(lastNotice()).toBe(true);
    });
  });

  const textsInDb = () => w.db.map((m) => (m.kind === 'user_text' ? m.payload.text : m.kind));

  test('A check that throws during a hold releases it and leaves the chat alone', ({ given, when, then, and }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the next check throws and the app goes to the background and returns', async () => {
      w.clock.t = at(6, 7);
      w.failChecks = 1;
      await switchApp();
    });
    then('the feed should have been held then released and a failure logged', () => {
      expect(w.held).toEqual([true, false]);
      expect(w.warns).toContain('chat_day_check_failed');
      expect(w.epochs).toBe(0);
    });
    and('the log should be unchanged', () => {
      expect(messages()).toHaveLength(1);
      expect(w.db).toHaveLength(1);
    });
    when('a message is sent', async () => {
      session.recorder.recordUser('still here');
      await session.settled();
    });
    then('the message should be recorded after the old one', () => {
      expect(messages().map((m) => m.seq)).toEqual([1, 2]);
      expect(w.db).toHaveLength(2);
    });
  });

  test("A parse result that lands during a hold stays out of the new day, but the user's send survives", ({ given, when, and, then }) => {
    given('a screen that started on the 5th with a chat and a parse running', async () => {
      await startedOnFifth(true)();
      w.busy = true;
    });
    when(
      "the clock moves to the 6th, the app returns, a parse result lands and the user sends a message during the check",
      () => {
        w.clock.t = at(6, 7);
        w.checkGate = deferred();
        session.onAppState('background');
        session.onAppState('active');
        session.recorder.recordXavier(textBubble('Logged lunch.'), { logged: true });
        session.recorder.recordUser('my own message');
      }
    );
    and('the check completes', async () => {
      w.checkGate!.open();
      await session.settled();
    });
    then('the database should hold only the user\'s message, under the day "2026-10-06"', () => {
      expect(textsInDb()).toEqual(['my own message']);
      expect(dbKeys()).toEqual(['2026-10-06']);
      expect(messages().map((m) => m.kind)).toEqual(['user_text']);
    });
  });

  test('Two stale resumes back to back reset once and leave the note consistent', ({ given, when, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the app goes to the background and returns twice', async () => {
      w.clock.t = at(6, 7);
      session.onAppState('background');
      session.onAppState('active');
      session.onAppState('background');
      session.onAppState('active');
      await session.settled();
    });
    then('the feed should end released, the layout should have reset once, and the shown note should match the stored one', () => {
      expect(w.held[w.held.length - 1]).toBe(false);
      expect(w.epochs).toBe(1);
      expect(lastNotice()).toBe(w.noticeFlag);
      expect(w.db).toEqual([]);
    });
  });

  test('A check that never answers releases the feed after the timeout, and still resets when it answers', ({ given, when, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the check hangs and the app goes to the background and returns', () => {
      w.clock.t = at(6, 7);
      w.checkGate = deferred();
      session.onAppState('background');
      session.onAppState('active');
    });
    then('the feed should be held', () => expect(w.held).toEqual([true]));
    when('the hold timeout fires', () => {
      expect(w.timers.filter((t) => !t.cleared).map((t) => t.ms)).toEqual([HOLD_TIMEOUT_MS]);
      w.timers.forEach((t) => {
        t.cleared = true;
        t.fn();
      });
    });
    then('the feed should be released and the slowness logged', () => {
      expect(w.held).toEqual([true, false]);
      expect(w.warns).toContain('chat_day_check_slow');
    });
    when('the check finally answers', async () => {
      w.checkGate!.open();
      await session.settled();
    });
    then('the chat should be cleared and the layout reset once', () => {
      expect(w.held).toEqual([true, false]);
      expect(messages()).toEqual([]);
      expect(w.db).toEqual([]);
      expect(w.epochs).toBe(1);
    });
  });

  test('Starting twice shares one load', ({ given, when, then }) => {
    given("a database holding today's chat", todaysChat);
    when('the screen starts today twice', async () => {
      session = make();
      await Promise.all([session.start(), session.start()]);
      await session.settled();
    });
    then('the check should have run once and the day should be loaded', () => {
      expect(w.checkTriggers).toEqual(['cold_launch']);
      expect(w.loaded).toBe(true);
      expect(messages()).toHaveLength(1);
    });
  });

  test('A reply that began before a reset can tell the day was cleared', ({ given, when, then }) => {
    let before = 0;
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when("a reply notes the day's reset count, then the clock moves to the 6th and the app returns", async () => {
      before = w.epochs;
      w.clock.t = at(6, 7);
      await switchApp();
    });
    then('the reset count should have moved before the reply lands', () => {
      expect(w.epochs).toBeGreaterThan(before);
    });
  });

  test('A send held through the check keeps its reply when the check resets', ({ given, when, and, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the app returns, the user sends during the check, its parse starts and replies', () => {
      w.clock.t = at(6, 7);
      w.checkGate = deferred();
      session.onAppState('background');
      session.onAppState('active');
      session.recorder.recordUser('lunch 12');
      w.busy = true;
      session.recorder.recordXavier(textBubble('Logged lunch.'), { logged: true });
    });
    and('the check completes', async () => {
      w.checkGate!.open();
      await session.settled();
    });
    then(
      'the database should hold the user\'s message and Xavier\'s reply, both under the day "2026-10-06"',
      () => {
        expect(w.db.map((m) => m.kind)).toEqual(['user_text', 'xavier_text']);
        expect(dbKeys()).toEqual(['2026-10-06', '2026-10-06']);
        expect(session.recorder.isFenced()).toBe(false);
      }
    );
  });

  test("A remounted screen waits for the previous mount's in-flight write", ({ given, when, and, then }) => {
    let starting: Promise<void> = Promise.resolve();
    let second: ChatSession;
    let gate: Deferred | null = null;
    given('a screen that started on the 5th with an empty chat', startedOnFifth(false));
    when('a message write is in flight, the screen is closed, and a new screen starts on the shared chain', async () => {
      gate = deferred();
      w.appendGate = gate;
      session.recorder.recordUser('from the first mount');
      await Promise.resolve();
      session.dispose();
      second = make();
      starting = second.start();
      await Promise.resolve();
    });
    and('the write completes', async () => {
      gate!.open();
      await starting;
      await second.settled();
    });
    then('the new screen should load the written message', () => {
      expect(second.recorder.state().messages.map((m) => m.kind)).toEqual(['user_text']);
    });
  });

  test('Closing the screen cancels a pending hold timeout', ({ given, when, and, then }) => {
    given('a screen that started on the 5th with a chat', startedOnFifth(true));
    when('the clock moves to the 6th and the check hangs and the app goes to the background and returns', () => {
      w.clock.t = at(6, 7);
      w.checkGate = deferred();
      session.onAppState('background');
      session.onAppState('active');
      expect(w.timers.filter((t) => !t.cleared)).toHaveLength(1);
    });
    and('the screen is closed', () => session.dispose());
    then('no hold timeout should be left pending', () => {
      expect(w.timers.filter((t) => !t.cleared)).toEqual([]);
      w.checkGate!.open();
    });
  });
});

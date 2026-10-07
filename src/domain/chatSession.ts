/**
 * The chat session controller (docs/design/xavier-daily-chat-spec.md §6.1, §8):
 * everything that decides WHEN the day is checked, what a reset does to the log,
 * and in what order the database hears about it. Framework-free: the hook
 * (src/features/chat/useChatLog.ts) injects the repository, the clock and the
 * state publishers, and forwards AppState changes. Covered by BDD in plain Node.
 *
 * Ordering. One chain serialises the database work: message writes, the launch
 * check and every resume check. A write queued after a check therefore runs after
 * its clear. Each write also re-reads `generation` immediately before it touches
 * the database, and every clear of the day (a reset, a restore) bumps it: a write
 * that belongs to the cleared day never lands.
 *
 * Launch. The check runs BEFORE today's rows are read (the screen mounts only
 * after the first unlock). If it throws, the day loads anyway but the check is
 * retried once the load lands, and again on every resume; it is not marked done.
 *
 * Resume. The gate (`chatCheckGateReduce`) fires on background -> active whatever
 * the lock state: the check only touches the database and renders nothing, so it
 * runs behind the lock cover. The feed is held (`publish.held`) and the recorder
 * queues calls only when a reset is possible (the oldest message in memory is
 * from another day), so an ordinary same-day resume never blanks anything. A
 * message recorded while held is replayed after the check, under whatever day it
 * decided, so it is never stamped with a day that is about to be cleared.
 *
 * The one-time note. Armed by a reset, read back from the stored flag on load,
 * disarmed by the next check that does not reset: an app switch (background and
 * back) before the first message therefore disarms it, matching "cleared on the
 * next open". The first message clears the stored flag (`clearNotice`).
 *
 * Reset. `reset` is the single entry for the daily rollover and for a restore.
 * The hold timeout is a deliberate trade: after `HOLD_TIMEOUT_MS` the feed is shown
 * and the recorder stops queuing. Anything recorded between then and a LATE reset is
 * cleared with the old day (memory and database alike), rather than surviving as a
 * ghost row stamped with a day that was cleared. Dropping beats a stale-keyed row.
 *
 * A restore clears the rows again on the chain (after any write already running)
 * and a hung check releases the held feed after `HOLD_TIMEOUT_MS`.
 * If an operation (a parse, a save) is running (`isBusy`), the recorder is fenced:
 * its late results are dropped until the screen calls `unfence`.
 */
import { ChatLogState, diffChatLog } from './chatLog';
import { ChatMessage, ChatStatus } from './chatMessage';
import {
  ChatCheckGate,
  ChatResetDecision,
  ChatResetTrigger,
  INITIAL_CHAT_CHECK_GATE,
  chatCheckGateReduce,
  chatDayKey,
} from './chatDay';
import { createChatRecorder } from './chatRecorder';

/**
 * The serial chain that database work runs on. One per app launch (the hook keeps
 * it at module scope), shared by every session, so a remounted screen's load waits
 * for the previous mount's in-flight writes.
 */
export function createChatChain() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      const run = tail.then(job);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    /** Resolves when everything queued so far (and anything it queued) has run. */
    async settled(): Promise<void> {
      let seen: Promise<unknown>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
  };
}
export type ChatChain = ReturnType<typeof createChatChain>;

export interface ChatSessionDeps {
  /** Defaults to a private chain; the hook injects the shared one. */
  chain?: ChatChain;
  now: () => number;
  newId: () => string;
  idleGreeting: string;
  /** True while a parse / save is running (read when the day clears). */
  isBusy: () => boolean;
  warn: (code: string) => void;
  checkDay: (input: {
    now: number;
    trigger: ChatResetTrigger;
  }) => Promise<ChatResetDecision>;
  listDay: (dayKey: string) => Promise<ChatMessage[]>;
  getRevision: () => Promise<number>;
  getStoredNotice: () => Promise<boolean>;
  clearStoredNotice: () => Promise<void>;
  /** Deletes every chat row (after a restore, on the chain, so a blocked write cannot outlive it). */
  clearAll: () => Promise<void>;
  appendMessage: (m: ChatMessage) => Promise<void>;
  updateContent: (m: ChatMessage) => Promise<void>;
  setStatus: (id: string, status: ChatStatus) => Promise<void>;
  /** "The launch check has run this app launch" survives a remount of the screen. */
  launch: { done: () => boolean; markDone: () => void };
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
  /** A restore replaced the database. Returns the unsubscribe. */
  subscribeRestored: (listener: () => void) => () => void;
  publish: {
    state: (next: ChatLogState) => void;
    dayKey: (dayKey: string) => void;
    notice: (on: boolean) => void;
    held: (on: boolean) => void;
    loaded: () => void;
    epoch: () => void;
  };
}

/** How long a hung check may hold the feed before it is shown anyway. */
export const HOLD_TIMEOUT_MS = 3000;

/** A content-free code for a dropped write. */
const failureCode = (e: unknown): string =>
  e instanceof Error && e.message === 'chat_invalid_write' ? 'chat_invalid_write' : 'chat_db_error';

export function createChatSession(deps: ChatSessionDeps) {
  const chain = deps.chain ?? createChatChain();
  const holdTimers = new Set<unknown>();
  let generation = 0;
  let started = false;
  let disposed = false;
  let pendingCheck: ChatResetTrigger | null = null;
  let gate: ChatCheckGate = INITIAL_CHAT_CHECK_GATE;
  let unsubscribe: (() => void) | null = null;
  let starting: Promise<void> | null = null;
  /** Checks currently holding the feed; it is shown again when the last lets go. */
  let holds = 0;

  const enqueue = chain.enqueue;

  const persist = (prev: ChatLogState, next: ChatLogState) => {
    deps.publish.state(next);
    const diff = diffChatLog(prev, next);
    const ops: Array<() => Promise<void>> = [
      ...diff.added.map((m) => () => deps.appendMessage(m)),
      ...diff.contentChanged.map((m) => () => deps.updateContent(m)),
      ...diff.statusChanged.map((c) => () => deps.setStatus(c.id, c.status)),
    ];
    if (!ops.length) return;
    const queuedIn = generation;
    void enqueue(async () => {
      for (const op of ops) {
        // Re-read right before the write: a clear of the day since it was queued voids it.
        if (queuedIn !== generation) return;
        try {
          await op();
        } catch (e) {
          deps.warn(`dropped a write (${failureCode(e)})`);
        }
      }
    });
  };

  const recorder = createChatRecorder({
    newId: deps.newId,
    now: deps.now,
    idleGreeting: deps.idleGreeting,
    warn: deps.warn,
    onChange: persist,
  });

  /** The day was cleared (the daily rollover, or a restore): the one entry for both. */
  const reset = (dayKey: string, options?: { notice?: boolean; fence?: boolean }) => {
    generation += 1;
    recorder.reset(dayKey, { fence: options?.fence ?? deps.isBusy() });
    deps.publish.dayKey(dayKey);
    deps.publish.notice(options?.notice ?? false);
    deps.publish.epoch();
  };

  /**
   * A restore replaced the database: the screen resets at once, and the chat rows
   * are cleared again ON THE CHAIN, after any write that was already running, so
   * a write blocked behind the restore cannot leave a row behind.
   */
  const onRestored = () => {
    reset(chatDayKey(deps.now()));
    void enqueue(async () => {
      try {
        await deps.clearAll();
      } catch {
        deps.warn('chat_restore_clear_failed');
      }
    });
  };

  /** Could a check clear this log? Only if its oldest message is from another day. */
  const mayReset = (): boolean => {
    const oldest = recorder
      .state()
      .messages.reduce<string | null>((min, m) => (min === null || m.dayKey < min ? m.dayKey : min), null);
    return oldest !== null && oldest !== chatDayKey(deps.now());
  };

  const check = (trigger: ChatResetTrigger): Promise<void> => {
    if (!started) {
      pendingCheck = pendingCheck ?? trigger;
      return Promise.resolve();
    }
    let holding = mayReset();
    let timer: unknown = null;
    // An operation already running when the check STARTS belongs to the old day. One
    // that starts during the hold (the user's held send) is the new day's: not fenced.
    const busyAtStart = deps.isBusy();
    const letGo = () => {
      if (!holding) return;
      holding = false;
      holds -= 1;
      if (holds === 0) {
        recorder.release();
        deps.publish.held(false);
      }
    };
    if (holding) {
      holds += 1;
      recorder.hold();
      deps.publish.held(true);
      // A hung database must not leave the screen blank: reveal, and let the check finish.
      timer = deps.timers.set(() => {
        holdTimers.delete(timer);
        deps.warn('chat_day_check_slow');
        letGo();
      }, HOLD_TIMEOUT_MS);
      holdTimers.add(timer);
    }
    return enqueue(async () => {
      try {
        const decision = await deps.checkDay({ now: deps.now(), trigger });
        deps.launch.markDone();
        if (disposed) return;
        if (decision.reset) {
          reset(decision.dayKey, { notice: true, fence: busyAtStart && deps.isBusy() });
        } else {
          deps.publish.notice(false);
          if (recorder.adoptDayIfEmpty(decision.dayKey)) deps.publish.dayKey(decision.dayKey);
        }
      } catch {
        deps.warn('chat_day_check_failed');
      } finally {
        if (timer !== null) {
          deps.timers.clear(timer);
          holdTimers.delete(timer);
        }
        letGo();
      }
    });
  };

  const load = async () => {
    let dayKey = chatDayKey(deps.now());
    if (!deps.launch.done()) {
      try {
        const decision = await deps.checkDay({ now: deps.now(), trigger: 'cold_launch' });
        deps.launch.markDone();
        dayKey = decision.dayKey;
      } catch {
        // Not marked done: retried as soon as the day has loaded, and on every resume.
        deps.warn('chat_day_check_failed');
        pendingCheck = 'cold_launch';
      }
    }
    let notice = false;
    try {
      notice = await deps.getStoredNotice();
    } catch {
      deps.warn('chat_notice_read_failed');
    }
    try {
      const [rows, revision] = await Promise.all([deps.listDay(dayKey), deps.getRevision()]);
      if (disposed) return;
      recorder.load(rows, revision, dayKey);
    } catch {
      deps.warn('chat_load_failed');
      if (disposed) return;
      recorder.loadFailed(dayKey);
    }
    deps.publish.dayKey(dayKey);
    deps.publish.notice(notice);
    deps.publish.loaded();
    started = true;
  };

  return {
    recorder,
    /** Subscribes to restores, runs the launch check, reads today's rows. */
    start(): Promise<void> {
      disposed = false;
      unsubscribe ??= deps.subscribeRestored(onRestored);
      // Idempotent: a second call (a dev double-mount) shares the first load.
      starting ??= (async () => {
        await enqueue(load);
        // A check that arrived (or failed) before the day loaded runs now.
        const waiting = pendingCheck;
        pendingCheck = null;
        if (waiting && !disposed) await check(waiting);
      })();
      return starting;
    },
    /** Forward every AppState change; never call it from a timer. */
    onAppState(to: string): void {
      const step = chatCheckGateReduce(gate, to);
      gate = step.gate;
      if (step.run) void check(step.run);
    },
    reset,
    /** The first message of the day: disarms the stored note. */
    clearNotice(): void {
      deps.clearStoredNotice().catch(() => deps.warn('chat_notice_clear_failed'));
    },
    dispose(): void {
      disposed = true;
      holdTimers.forEach((t) => deps.timers.clear(t));
      holdTimers.clear();
      unsubscribe?.();
      unsubscribe = null;
    },
    /** Resolves when everything queued so far has run (for tests and shutdown). */
    settled: chain.settled,
  };
}

export type ChatSession = ReturnType<typeof createChatSession>;

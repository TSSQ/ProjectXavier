/**
 * The chat recorder (docs/design/xavier-daily-chat-spec.md §9 slice 2): the
 * sequencing logic between the screen and the pure reducer, in plain Node so
 * the BDD suite covers it. The hook (src/features/chat/useChatLog.ts) only
 * supplies ids, the clock, and persistence.
 *
 * What it owns:
 *  - Explicit calls, no mirroring. A card is created with `showCard`, which
 *    returns its id at once; every later call names that id (`updateCard`,
 *    `resolve`, `dismiss`, `expire`). A second card of the same kind is a
 *    different card. Nothing is inferred from what the screen shows.
 *  - Ordering. Calls made before today's rows have loaded wait in order and run
 *    when `load` lands; ids are allocated at call time, so `showCard` can return
 *    one before the load.
 *  - The session day key, fixed at load, stamped on everything written.
 *  - Safety. A reducer failure is caught and reported as `chat_reduce_failed`
 *    (no content); nothing here throws into the caller.
 */
import { BubbleContent, textBubble } from './bubbleCopy';
import { chatDayKey } from './chatDay';
import {
  CardBody,
  ChatLogState,
  newestLiveCard,
  EMPTY_CHAT_LOG,
  ChatAction,
  chatLogReducer,
} from './chatLog';
import { ChatCardKind, ChatMessage } from './chatMessage';
import { bubbleBody, photoBody } from './chatRecord';

export interface RecorderDeps {
  newId: () => string;
  now: () => number;
  /** Called with every state change, for persistence and publishing. */
  onChange: (prev: ChatLogState, next: ChatLogState) => void;
  /** A content-free code for a problem that was swallowed. */
  warn: (code: string) => void;
  /** The idle greeting is not a message; it is never recorded. */
  idleGreeting: string;
}

/** A revision change reaches only the cards the screen already drops on one
 *  (`dropStaleReply` for budget answers, the tx-op picker's own check). */
export const STALE_ON_REVISION_KINDS: readonly ChatCardKind[] = [
  'afford',
  'afford_pick',
  'set_budget',
  'tx_picker',
];

export interface ResolveOptions {
  /** The card's final content (e.g. the account as it was edited before Create). */
  body?: CardBody;
  /** The receipt or line that replaces the card. */
  then?: BubbleContent;
  /** Only a live card of one of these kinds is resolved (defaults to the body's kind). */
  kinds?: readonly ChatCardKind[];
  /** `then` confirms a transaction saved from the chat (counted by the header). */
  logged?: boolean;
}

export function createChatRecorder(deps: RecorderDeps) {
  let state: ChatLogState = EMPTY_CHAT_LOG;
  let ready = false;
  let sessionDayKey: string | null = null;
  let revision: number | null = null;
  let queued: Array<{ thunk: () => void; user: boolean }> = [];
  /** After a reset with an operation still in flight: its late results are dropped
   *  until the screen calls `unfence` (the operation has finished). */
  let fenced = false;
  /** A resume check is in flight: calls wait, in order, and replay on `release`. */
  let holding = false;
  /** The id `showCard` last returned, for asking before the load has landed. */
  let lastShown: { id: string; kind: ChatCardKind } | null = null;

  const run = (action: ChatAction) => {
    try {
      const prev = state;
      const next = chatLogReducer(prev, action);
      if (next === prev) return;
      state = next;
      deps.onChange(prev, next);
    } catch {
      deps.warn('chat_reduce_failed');
    }
  };

  /** Runs `thunk` now, or in order once today's rows have loaded. */
  const act = (thunk: () => void, user = false) => {
    if (fenced) return;
    if (ready) {
      try {
        thunk();
      } catch {
        deps.warn('chat_reduce_failed');
      }
    } else queued.push({ thunk, user });
  };

  const stampAt = (id: string, now: number) => ({ id, now, dayKey: sessionDayKey ?? chatDayKey(now) });

  const settleReady = () => {
    ready = true;
    const pending = queued;
    queued = [];
    // Replayed past the fence on purpose: `reset` already dropped the old day's calls.
    pending.forEach((q) => {
      try {
        q.thunk();
      } catch {
        deps.warn('chat_reduce_failed');
      }
    });
  };

  const api = {
    state: (): ChatLogState => state,
    isReady: () => ready,
    /**
     * The id of the card the screen should act on: the newest live card. (Before
     * the load lands the log is empty, so this is the card just shown.) One
     * shared answer for every resolve / dismiss / expire / update call site.
     */
    liveCardId: (kinds?: readonly ChatCardKind[]): string | null => {
      const found = ready ? newestLiveCard(state) : lastShown;
      if (!found) return null;
      return !kinds || kinds.includes(found.kind as ChatCardKind) ? found.id : null;
    },
    sessionDayKey: () => sessionDayKey,
    isFenced: () => fenced,
    /**
     * A day check is about to run: calls made until `release` wait, so a message
     * sent during it is stamped with the day the check decides (under the new key
     * after a reset) instead of being cleared with the old one.
     */
    hold() {
      if (!ready) return;
      holding = true;
      ready = false;
    },
    /** The check has settled: replay what waited, in order, on whatever day it is now. */
    release() {
      if (!holding) return;
      holding = false;
      settleReady();
    },
    /**
     * A check found nothing to clear but the clock has moved to another day (an
     * empty chat left open past midnight): stamp what comes next with the new
     * day. Only while the log is empty, so nothing already shown changes day.
     * Returns whether the day was adopted.
     */
    adoptDayIfEmpty(dayKey: string): boolean {
      if (state.messages.length > 0) return false;
      sessionDayKey = dayKey;
      return true;
    },
    /** The operation that was in flight at the reset has finished: record again. */
    unfence() {
      fenced = false;
    },

    /** Today's stored rows have loaded: fix the session day and replay waiting calls. */
    load(rows: ChatMessage[], currentRevision: number, dayKey?: string) {
      revision = currentRevision;
      sessionDayKey = dayKey ?? chatDayKey(deps.now());
      // Seed with the stored rows so the reload rule's status changes are diffed and written.
      state = { messages: rows };
      run({ type: 'load', messages: rows, currentRevision });
      settleReady();
    },
    /** The load failed: record from an empty day anyway. */
    loadFailed(dayKey?: string) {
      sessionDayKey = dayKey ?? chatDayKey(deps.now());
      settleReady();
    },
    /**
     * The daily reset cleared the chat (src/features/chat/repository.ts
     * `checkChatDay`): start a fresh day. Empties the in-memory log, fixes the
     * session day key again and stays ready. With `fence`, an operation that was
     * already running when the day cleared belongs to the OLD day: every write
     * is dropped until `unfence`, so its late result cannot land in the new one.
     */
    reset(dayKey: string, options?: { fence?: boolean }) {
      fenced = options?.fence ?? false;
      lastShown = null;
      const prev = state;
      state = EMPTY_CHAT_LOG;
      sessionDayKey = dayKey;
      if (!holding) {
        queued = [];
        ready = true;
      } else if (fenced) {
        // What waited during the hold and came from the operation that was running
        // belongs to the old day; the user's own sends still replay on the new one.
        queued = queued.filter((q) => q.user);
      }
      try {
        if (prev !== state) deps.onChange(prev, state);
      } catch {
        deps.warn('chat_reduce_failed');
      }
    },

    recordUser(text: string) {
      const id = deps.newId();
      const now = deps.now();
      act(() => run({ type: 'user', stamp: stampAt(id, now), body: { kind: 'user_text', payload: { text } } }), true);
    },
    /** A photo the user sent: the label only, never the image. */
    recordPhoto(label: string) {
      const id = deps.newId();
      const now = deps.now();
      act(() => run({ type: 'user', stamp: stampAt(id, now), body: photoBody(label) }), true);
    },
    /** Xavier's words. `logged` marks the line confirming a transaction saved here. */
    recordXavier(content: BubbleContent, options?: { logged?: boolean }) {
      if (content.kind === 'text' && content.text === deps.idleGreeting) return;
      const id = deps.newId();
      const now = deps.now();
      act(() => run({ type: 'xavier', stamp: stampAt(id, now), body: bubbleBody(content, options) }));
    },

    /** A card appears. Returns its id immediately. */
    showCard(body: CardBody, dataRevision?: number): string {
      const id = deps.newId();
      const now = deps.now();
      lastShown = { id, kind: body.kind };
      act(() => run({ type: 'card', stamp: stampAt(id, now), body, dataRevision: dataRevision ?? revision }));
      return id;
    },
    /** A live card's content changed (an edit, a queue advancing). */
    updateCard(cardId: string, body: CardBody, dataRevision?: number) {
      act(() => run({ type: 'update', cardId, kinds: [body.kind], payload: body.payload, dataRevision }));
    },
    /** The card was acted on successfully; its receipt or line follows. */
    resolve(cardId: string, options?: ResolveOptions) {
      if (lastShown?.id === cardId) lastShown = null;
      const id = deps.newId();
      const now = deps.now();
      act(() =>
        run({
          type: 'resolve',
          cardId,
          kinds: options?.kinds ?? (options?.body ? [options.body.kind] : undefined),
          payloadKind: options?.body?.kind,
          payload: options?.body?.payload,
          then: options?.then
            ? { stamp: stampAt(id, now), body: bubbleBody(options.then, { logged: options.logged }) }
            : undefined,
        })
      );
    },
    /**
     * Discard / Cancel / Not now: stub the card. `text` is Xavier's line, passed
     * ONLY where the screen shows one, so the log never claims a line the user
     * did not see. With no card (`null`) just the line is recorded. A query
     * answer just stays.
     */
    dismiss(cardId: string | null, text?: string, kinds?: readonly ChatCardKind[]) {
      if (cardId === null) {
        if (text !== undefined) api.recordXavier(textBubble(text));
        return;
      }
      if (lastShown?.id === cardId) lastShown = null;
      const id = deps.newId();
      const now = deps.now();
      act(() => run({ type: 'dismiss', cardId, kinds, stamp: stampAt(id, now), text }));
    },
    /** The card's data moved on (the stale-draft explanation): its stub reads "out of date". */
    expire(cardId: string, kinds?: readonly ChatCardKind[]) {
      if (lastShown?.id === cardId) lastShown = null;
      act(() => run({ type: 'expire', cardId, kinds }));
    },
    /** Last resort: the screen cleared its cards with no word on why. */
    abandonLive() {
      act(() => run({ type: 'abandon_live' }));
    },
    /** The screen's latest data revision (focus). */
    noteRevision(currentRevision: number) {
      revision = currentRevision;
      act(() => run({ type: 'stale', currentRevision, kinds: STALE_ON_REVISION_KINDS }));
    },
  };
  return api;
}

export type ChatRecorder = ReturnType<typeof createChatRecorder>;

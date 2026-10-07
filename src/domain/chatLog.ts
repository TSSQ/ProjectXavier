/**
 * The chat log reducer (docs/design/xavier-daily-chat-spec.md §6.2). Pure and
 * framework-free: the recorder (src/domain/chatRecorder.ts) feeds it actions
 * and the hook persists the diff (`diffChatLog`); nothing here touches storage
 * or the clock (ids, `now` and the day key arrive on the action's stamp).
 *
 * Model: an ordered list of messages with statuses. Only the NEWEST card is
 * interactive; everything above it is read-only. A card ends because the
 * caller SAID why; nothing here infers it:
 *  - resolved   Confirm / Create / Log it / a chip: hidden, its receipt or text
 *               is appended (a query answer stays visible as history);
 *  - abandoned  a new user message arrived while it was live, or it was
 *               dismissed: a dashed stub (a dismiss also appends Xavier's line);
 *  - stale      the data moved on (a revision change, or the stale-draft
 *               explanation): the stub plus " · out of date".
 * Reload rule (`applyReloadRule`): the screen's card state is not persisted, so
 * NOTHING reloads as interactive.
 */
import { chatDayKey } from './chatDay';
import {
  CHAT_CARD_KINDS,
  ChatCardKind,
  ChatKind,
  ChatMessage,
  ChatStatus,
  isChatCardKind,
} from './chatMessage';

export interface ChatLogState {
  messages: ChatMessage[];
}

export const EMPTY_CHAT_LOG: ChatLogState = { messages: [] };

/** A message's kind and payload, without the bookkeeping the reducer adds. */
export type ChatBody = {
  [K in ChatKind]: { kind: K; payload: Extract<ChatMessage, { kind: K }>['payload'] };
}[ChatKind];
export type CardBody = Extract<ChatBody, { kind: ChatCardKind }>;
type UserBody = Extract<ChatBody, { kind: 'user_text' | 'user_photo' }>;
type XavierBody = Extract<ChatBody, { kind: 'xavier_text' | 'xavier_receipt' }>;

/** A fresh id and the clock reading for whatever the action appends. */
export interface Stamp {
  id: string;
  now: number;
  /** The session's day key (fixed at load); defaults to the clock's local day. */
  dayKey?: string;
}

export type ChatAction =
  /** Today's stored rows, with the current data revision (the reload rule). */
  | { type: 'load'; messages: ChatMessage[]; currentRevision: number }
  /** The user sent something: abandons a live card, then appends. */
  | { type: 'user'; stamp: Stamp; body: UserBody }
  | { type: 'xavier'; stamp: Stamp; body: XavierBody }
  /** A card appears (live). `dataRevision` is what it was built against. */
  | { type: 'card'; stamp: Stamp; body: CardBody; dataRevision: number | null }
  /** The card was acted on: mark it resolved, optionally store its final
   *  content, and append its receipt or text. */
  | { type: 'resolve'; cardId: string; payload?: CardBody['payload']; then?: { stamp: Stamp; body: XavierBody } }
  /** Discard / Cancel / Not now: stub the card, and append Xavier's line only
   *  when the screen showed one (`text`). A query answer is not a discard: it
   *  just stays, read-only, with no line. */
  | { type: 'dismiss'; cardId: string; stamp: Stamp; text?: string }
  /** The card's data moved on (the stale-draft explanation): stub " · out of date". */
  | { type: 'expire'; cardId: string }
  /** Last resort when the screen clears its cards with no word on why. */
  | { type: 'abandon_live' }
  /** The data revision moved. `kinds` limits which live cards it reaches. */
  | { type: 'stale'; currentRevision: number; kinds?: readonly ChatCardKind[] }
  /** A live card's content changed (an edit, a queue advancing). */
  | { type: 'update'; cardId: string; payload: CardBody['payload']; dataRevision?: number | null };

const ROLE_OF: Record<ChatKind, ChatMessage['role']> = {
  user_text: 'user',
  user_photo: 'user',
  xavier_text: 'xavier',
  xavier_receipt: 'xavier',
  draft: 'xavier',
  account_create: 'xavier',
  account_update: 'xavier',
  afford: 'xavier',
  afford_pick: 'xavier',
  set_budget: 'xavier',
  delete_handoff: 'xavier',
  tx_picker: 'xavier',
  query_answer: 'xavier',
  statement_queue: 'xavier',
};

/** A query answer is history, not a prompt: it never collapses to a stub. */
const endStatus = (kind: ChatKind, ended: 'abandoned' | 'stale'): ChatStatus =>
  kind === 'query_answer' ? 'resolved' : ended;

const isLiveCard = (m: ChatMessage): boolean => isChatCardKind(m.kind) && m.status === 'live';

function append(
  state: ChatLogState,
  stamp: Stamp,
  body: ChatBody,
  status: ChatStatus,
  dataRevision: number | null
): ChatLogState {
  const dayKey = stamp.dayKey ?? chatDayKey(stamp.now);
  const seq = state.messages.reduce((n, m) => (m.dayKey === dayKey ? Math.max(n, m.seq) : n), 0) + 1;
  const message = {
    id: stamp.id,
    dayKey,
    seq,
    role: ROLE_OF[body.kind],
    kind: body.kind,
    payload: body.payload,
    status,
    dataRevision,
    createdAt: stamp.now,
  } as ChatMessage;
  return { messages: [...state.messages, message] };
}

function mapStatus(
  state: ChatLogState,
  pick: (m: ChatMessage) => ChatStatus | null
): ChatLogState {
  let changed = false;
  const messages = state.messages.map((m) => {
    const next = pick(m);
    if (next === null || next === m.status) return m;
    changed = true;
    return { ...m, status: next } as ChatMessage;
  });
  return changed ? { messages } : state;
}

/** Live cards end as abandoned (a stub), except a query answer which stays. */
const abandonLive = (state: ChatLogState): ChatLogState =>
  mapStatus(state, (m) => (isLiveCard(m) ? endStatus(m.kind, 'abandoned') : null));

export function chatLogReducer(state: ChatLogState, action: ChatAction): ChatLogState {
  switch (action.type) {
    case 'load':
      return { messages: applyReloadRule(action.messages, action.currentRevision) };
    case 'user':
      return append(abandonLive(state), action.stamp, action.body, 'resolved', null);
    case 'xavier':
      return append(state, action.stamp, action.body, 'resolved', null);
    case 'card':
      return append(abandonLive(state), action.stamp, action.body, 'live', action.dataRevision);
    case 'resolve': {
      // The receipt is appended even if the card had already ended: the save
      // happened either way, and the log is a record of what Xavier said.
      const done = mapStatus(state, (m) => (m.id === action.cardId && isLiveCard(m) ? 'resolved' : null));
      const withPayload = action.payload && done !== state ? setPayload(done, action.cardId, action.payload) : done;
      return action.then ? append(withPayload, action.then.stamp, action.then.body, 'resolved', null) : withPayload;
    }
    case 'dismiss':
      return dismiss(state, action);
    case 'expire':
      return mapStatus(state, (m) => (m.id === action.cardId && isLiveCard(m) ? endStatus(m.kind, 'stale') : null));
    case 'abandon_live':
      return abandonLive(state);
    case 'stale':
      return mapStatus(state, (m) =>
        isLiveCard(m) &&
        (action.kinds ?? CHAT_CARD_KINDS).includes(m.kind as ChatCardKind) &&
        m.dataRevision !== action.currentRevision
          ? endStatus(m.kind, 'stale')
          : null
      );
    case 'update':
      return updateCard(state, action);
  }
}

function setPayload(state: ChatLogState, cardId: string, payload: CardBody['payload']): ChatLogState {
  return { messages: state.messages.map((m) => (m.id === cardId ? ({ ...m, payload } as ChatMessage) : m)) };
}

function dismiss(state: ChatLogState, a: Extract<ChatAction, { type: 'dismiss' }>): ChatLogState {
  const card = state.messages.find((m) => m.id === a.cardId);
  const line = (s: ChatLogState) =>
    a.text === undefined ? s : append(s, a.stamp, { kind: 'xavier_text', payload: { text: a.text } }, 'resolved', null);
  // The card had already ended (or never existed): the screen still showed its line.
  if (!card || !isLiveCard(card)) return line(state);
  if (card.kind === 'query_answer') return mapStatus(state, (m) => (m.id === a.cardId ? 'resolved' : null));
  return line(mapStatus(state, (m) => (m.id === a.cardId ? 'abandoned' : null)));
}

function updateCard(state: ChatLogState, a: Extract<ChatAction, { type: 'update' }>): ChatLogState {
  let changed = false;
  const messages = state.messages.map((m) => {
    if (m.id !== a.cardId || !isLiveCard(m)) return m;
    changed = true;
    return {
      ...m,
      payload: a.payload,
      dataRevision: a.dataRevision === undefined ? m.dataRevision : a.dataRevision,
    } as ChatMessage;
  });
  return changed ? { messages } : state;
}

/**
 * The reload rule. The screen's card state (a draft's text, a picker's rows) is
 * not persisted, so a card loaded from storage cannot be acted on: a query
 * answer becomes resolved (read-only history), every other live card becomes
 * abandoned, or stale when its revision differs from the current one. This is
 * also what an app killed mid-parse leaves behind: no live card, no spinner.
 */
export function applyReloadRule(messages: ChatMessage[], currentRevision: number): ChatMessage[] {
  return messages.map((m) => {
    if (!isLiveCard(m)) return m;
    if (m.kind === 'query_answer') return { ...m, status: 'resolved' } as ChatMessage;
    return { ...m, status: m.dataRevision !== currentRevision ? 'stale' : 'abandoned' } as ChatMessage;
  });
}

// ─── selectors ──────────────────────────────────────────────────────────────

export function newestCard(state: ChatLogState): ChatMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]!;
    if (isChatCardKind(m.kind)) return m;
  }
  return null;
}

export function newestLiveCard(state: ChatLogState): ChatMessage | null {
  const card = newestCard(state);
  return card && card.status === 'live' ? card : null;
}

/** Whether something not stored (the /account subtype chips, "Open Budget",
 *  the FM-refusal "Log anyway", the thinking state) is the live tail. */
export interface TailOptions {
  tailActive?: boolean;
}

/** Only the newest card, and only while live, can be tapped (or dismissed) —
 *  and not at all while an unstored tail owns the screen. */
export function isInteractive(message: ChatMessage, state: ChatLogState, options?: TailOptions): boolean {
  if (options?.tailActive) return false;
  return isChatCardKind(message.kind) && message.status === 'live' && newestCard(state)?.id === message.id;
}

export type ChatPresentation = 'bubble' | 'live' | 'readonly' | 'stub' | 'hidden';

/** How the feed shows a message. */
export function presentationOf(
  message: ChatMessage,
  state: ChatLogState,
  options?: TailOptions
): ChatPresentation {
  if (!isChatCardKind(message.kind)) return 'bubble';
  if (message.status === 'live') return isInteractive(message, state, options) ? 'live' : 'readonly';
  if (message.kind === 'query_answer') return 'readonly';
  return message.status === 'resolved' ? 'hidden' : 'stub';
}

/** "Today · N logged": the chat saves on `dayKey`. A save is counted by the
 *  Xavier message that confirms it (a receipt, or the plain "Saved." / series
 *  line), which carries `logged: true`. Edits, account creates and budget
 *  changes never carry it. */
export function loggedTodayCount(state: ChatLogState, dayKey: string): number {
  return state.messages.filter(
    (m) =>
      (m.kind === 'xavier_receipt' || m.kind === 'xavier_text') &&
      m.dayKey === dayKey &&
      m.payload.logged === true
  ).length;
}

// ─── persistence diff ───────────────────────────────────────────────────────

export interface ChatLogDiff {
  added: ChatMessage[];
  statusChanged: Array<{ id: string; status: ChatStatus }>;
  contentChanged: ChatMessage[];
}

/** What changed between two states, for the hook to write through the repository. */
export function diffChatLog(prev: ChatLogState, next: ChatLogState): ChatLogDiff {
  const before = new Map(prev.messages.map((m) => [m.id, m]));
  const diff: ChatLogDiff = { added: [], statusChanged: [], contentChanged: [] };
  for (const m of next.messages) {
    const old = before.get(m.id);
    if (!old) diff.added.push(m);
    else {
      if (old.status !== m.status) diff.statusChanged.push({ id: m.id, status: m.status });
      if (old.dataRevision !== m.dataRevision || JSON.stringify(old.payload) !== JSON.stringify(m.payload)) {
        diff.contentChanged.push(m);
      }
    }
  }
  return diff;
}

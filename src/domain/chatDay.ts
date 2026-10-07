/**
 * The chat's daily reset (docs/design/xavier-daily-chat-spec.md §6.1). Pure and
 * framework-free; the runtime only feeds it events and applies its answers.
 *
 * Rules:
 *  - The day key is the LOCAL calendar date, taken from `localDayNoon` (the
 *    app's single definition of "which local day is this epoch"), so a time
 *    zone change or a DST day shifts it exactly as it shifts everything else.
 *  - A reset check runs only on a cold launch, or when the app becomes active
 *    after having been in the background, and only once the app is unlocked.
 *    Never on a timer: a conversation that runs past midnight continues until
 *    the app is left.
 *  - If any stored message belongs to a different day than today, the whole
 *    chat is cleared and a one-time note is armed.
 *
 * Reload rules (see also src/domain/chatMessage.ts):
 *  - Messages carry the SESSION day key (fixed at load), not the wall clock at
 *    write, so a session that runs past midnight stays one day. Rows from an
 *    older day can still be present (the app was left and reopened): the check
 *    compares the OLDEST stored key to today, so everything clears on the next
 *    open.
 *  - Nothing reloads as interactive: the screen's card state is not stored, so
 *    a stored live card becomes abandoned (or stale), a query answer resolved.
 *  - The read-decide-clear sequence must run as one exclusive section in the
 *    repository (src/features/chat/repository.ts `checkChatDay`); the decision
 *    functions here stay pure.
 */
import { localDayNoon } from './dates';

/** 'YYYY-MM-DD' for the local calendar day containing `epoch`. */
export function chatDayKey(epoch: number): string {
  const d = new Date(localDayNoon(epoch));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${mm}-${dd}`;
}

// ─── when a check may run ───────────────────────────────────────────────────

export type ChatResetTrigger = 'cold_launch' | 'resume';

/** The lifecycle events the runtime can report. `timer` exists so the
 *  "never on a timer" rule is stated and tested, not just assumed. */
export type ChatLifecycleEvent =
  | { kind: 'launch' }
  | { kind: 'app_state'; from: string; to: string }
  | { kind: 'timer' };

/**
 * Which reset trigger (if any) a lifecycle event is. Only a launch, and an
 * AppState change to 'active' FROM 'background', count: 'inactive' -> 'active'
 * (a Face ID sheet, Control Center, a call banner) is not "left the app".
 */
export function chatResetTrigger(event: ChatLifecycleEvent): ChatResetTrigger | null {
  if (event.kind === 'launch') return 'cold_launch';
  if (event.kind === 'app_state' && event.from === 'background' && event.to === 'active') {
    return 'resume';
  }
  return null;
}

// ─── the decision ───────────────────────────────────────────────────────────

export type ChatResetDecision =
  | { reset: false; dayKey: string }
  | { reset: true; dayKey: string; staleDayKey: string };

/**
 * Whether to clear the chat. `oldestStoredDayKey` is the earliest day still in
 * the table (null when empty). `trigger` null (a timer, a non-resume state
 * change) and a locked app both mean "not now". An empty chat never resets, so
 * it never arms the note either.
 */
export function decideChatReset(input: {
  oldestStoredDayKey: string | null;
  now: number;
  trigger: ChatResetTrigger | null;
  unlocked: boolean;
}): ChatResetDecision {
  const dayKey = chatDayKey(input.now);
  if (!input.unlocked || input.trigger === null) return { reset: false, dayKey };
  const stale = input.oldestStoredDayKey;
  if (stale === null || stale === dayKey) return { reset: false, dayKey };
  return { reset: true, dayKey, staleDayKey: stale };
}

// ─── the one-time note ──────────────────────────────────────────────────────

/** The settings flag stored as '1' (set) or anything else (not set). */
export const resolveChatResetNotice = (raw: string | null): boolean => raw === '1';

/** After a check ran: armed by a reset, cleared by any later check that did not reset
 *  (the "next open"). */
export const noticeAfterCheck = (decision: ChatResetDecision): boolean => decision.reset;

/** The first message of the day clears it. */
export const noticeAfterMessage = (): boolean => false;

// ─── applying a check ───────────────────────────────────────────────────────

/** What a reset check needs from storage; the repository implements it. */
export interface ChatDayStore {
  oldestDayKey(): Promise<string | null>;
  clearAll(): Promise<void>;
  getNotice(): Promise<boolean>;
  setNotice(on: boolean): Promise<void>;
}

/**
 * One reset check against `store`. Clears the chat and arms the note on a
 * reset; otherwise disarms a note left from a previous open. The notice is
 * written only when it changes.
 */
export async function runChatDayCheck(
  store: ChatDayStore,
  input: { now: number; trigger: ChatResetTrigger | null; unlocked: boolean }
): Promise<ChatResetDecision> {
  // The same "not now" rule `decideChatReset` applies, checked first on purpose:
  // a locked or timer check must not touch the store at all (no read, and no
  // write that would disarm an armed note).
  if (!input.unlocked || input.trigger === null) {
    return { reset: false, dayKey: chatDayKey(input.now) };
  }
  const decision = decideChatReset({
    oldestStoredDayKey: await store.oldestDayKey(),
    ...input,
  });
  if (decision.reset) await store.clearAll();
  const want = noticeAfterCheck(decision);
  if ((await store.getNotice()) !== want) await store.setNotice(want);
  return decision;
}

/** The first message of the day: disarms the note if (and only if) it is armed. */
export async function clearNoticeOnMessage(store: ChatDayStore): Promise<void> {
  if (await store.getNotice()) await store.setNotice(noticeAfterMessage());
}

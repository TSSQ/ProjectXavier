/**
 * What the Assistant's chat feed shows (docs/design/xavier-daily-chat-spec.md
 * §3, §6.2, §6.3): pure and framework-free, so the row model, the ephemeral
 * tail and the scroll decision are BDD-tested in Node. The components in
 * src/components/assistant/ChatFeed.tsx only draw what this returns.
 *
 * Interactivity belongs to the SCREEN: the live card is whatever card state the
 * screen holds (a draft, a confirm, a picker...), rendered by the existing
 * interactive component. The log decides WHERE it sits (the newest live card's
 * place) and how every other card looks (read-only, a stub, or hidden).
 */
import { ChatLogState, newestLiveCard, presentationOf } from './chatLog';
import type { ChatMessage } from './chatMessage';
import { stubTextFor } from './chatCopy';

export type FeedRow =
  | { key: string; type: 'user'; message: ChatMessage }
  | { key: string; type: 'xavier'; message: ChatMessage }
  /** A query answer kept as history: redrawn from its stored result. */
  | { key: string; type: 'answer'; message: ChatMessage }
  | { key: string; type: 'stub'; message: ChatMessage; text: string }
  /** The screen's own interactive card. Always the last stored row. */
  | { key: 'live'; type: 'live' };

/** The stub for a card that is still "live" in the log but the screen is not showing. */
function stubOfUnshown(message: ChatMessage): string {
  return stubTextFor({ ...message, status: 'abandoned' } as ChatMessage) ?? '';
}

/**
 * State -> rows, oldest first. `hasLiveCard`: the screen holds a live card.
 * Its row is ALWAYS last (after every stored row, before the tail): the live
 * card is the one thing the user can act on, so it sits next to the composer.
 * Its position in the log matters only for history.
 *
 * A card the log calls live that the screen is not showing (the tail owns the
 * screen, or the two disagree) is drawn as its stub, never as nothing and never
 * as a third look. `onUnshown` lets the screen warn in dev.
 */
export function buildFeedRows(
  state: ChatLogState,
  options: { hasLiveCard: boolean; tailActive: boolean; onUnshown?: (message: ChatMessage) => void }
): FeedRow[] {
  const rows: FeedRow[] = [];
  const liveId = newestLiveCard(state)?.id ?? null;
  for (const message of state.messages) {
    // The live row draws this card.
    if (options.hasLiveCard && message.id === liveId) continue;
    const presentation = presentationOf(message, state, { tailActive: options.tailActive });
    switch (presentation) {
      case 'bubble':
        rows.push({ key: message.id, type: message.role === 'user' ? 'user' : 'xavier', message });
        break;
      case 'live':
      case 'readonly':
        if (message.kind === 'query_answer') {
          rows.push({ key: message.id, type: 'answer', message });
        } else {
          options.onUnshown?.(message);
          rows.push({ key: message.id, type: 'stub', message, text: stubOfUnshown(message) });
        }
        break;
      case 'stub':
        rows.push({ key: message.id, type: 'stub', message, text: stubTextFor(message) ?? '' });
        break;
      case 'hidden':
        break;
    }
  }
  if (options.hasLiveCard) rows.push({ key: 'live', type: 'live' });
  return rows;
}

// ─── the ephemeral tail ─────────────────────────────────────────────────────

export interface TailInput {
  busy: boolean;
  /** The screen holds a card with a stored kind (it shows its own spinner). */
  hasLiveCard: boolean;
  /** The /account Q&A is running, and which question it is on. */
  accountFlowStep: string | null;
  /** The FM-refusal "Log anyway" card is up. */
  fmRefusal: boolean;
  /** A budget reply with no stored card ("Open Budget" / "no budgets yet") is on screen. */
  budgetHint: boolean;
}

export interface Tail {
  /** Parsing or working with nothing else to show: the spinner. */
  thinking: boolean;
  /** "Step N of 3 / Cancel" while the /account Q&A runs. */
  accountProgress: boolean;
  /** The tap-don't-type subtype chips (the live row of the Q&A). */
  subtypeChips: boolean;
  fmRefusal: boolean;
  /** "Open Budget" / "no budgets yet" actions. */
  budgetHint: boolean;
  /** Any of the above: no stored card is interactive while it is. */
  active: boolean;
}

/** What hangs under the list, derived from screen state (never stored). */
export function computeTail(input: TailInput): Tail {
  const thinking = input.busy && !input.hasLiveCard;
  const accountProgress = input.accountFlowStep !== null;
  const subtypeChips = input.accountFlowStep === 'subtype';
  const budgetHint = input.budgetHint;
  return {
    thinking,
    accountProgress,
    subtypeChips,
    fmRefusal: input.fmRefusal,
    budgetHint,
    active: thinking || accountProgress || input.fmRefusal || budgetHint,
  };
}

// ─── scrolling (§6.3) ───────────────────────────────────────────────────────

/** Whether the list sits at (or within `threshold` of) its newest end. */
export function isNearBottom(distanceFromNewest: number, threshold: number): boolean {
  return distanceFromNewest <= threshold;
}

export type ScrollAction = 'scroll' | 'pill' | 'none';

/**
 * Sending always scrolls down. A new Xavier message scrolls only if the user
 * is already near the bottom; if they have scrolled up it must not yank them
 * back, so the "↓ New" pill appears instead.
 */
export function scrollDecision(event: 'sent' | 'incoming', nearBottom: boolean): ScrollAction {
  if (event === 'sent') return 'scroll';
  return nearBottom ? 'scroll' : 'pill';
}

/** The pill stays until the user is back near the bottom (or taps it). */
export function pillStillNeeded(pillShown: boolean, nearBottom: boolean): boolean {
  return pillShown && !nearBottom;
}

/**
 * Sent or incoming, for the messages added since the user last saw `seenCount`.
 * Decided per BATCH: any user message in it counts as sent, so a user message
 * and Xavier's reply landing together still scroll.
 */
export function batchEvent(state: ChatLogState, seenCount: number): 'sent' | 'incoming' | null {
  const added = state.messages.slice(seenCount);
  if (added.length === 0) return null;
  return added.some((m) => m.role === 'user') ? 'sent' : 'incoming';
}

// ─── layout phase and arrivals ──────────────────────────────────────────────

export type LayoutPhase = 'loading' | 'hero' | 'moving' | 'header';

/** The hero-to-header transition's timings (spec §4), in ms. */
export const HERO_TRANSITION = {
  /** The greeting bubble fades and lifts out. */
  greetingMs: 200,
  /** The avatar moves and shrinks (ease-in-out). */
  moveMs: 450,
  /** The header text fades in after the move. */
  headerFadeMs: 200,
  /** Reduce Motion: no movement, the avatar and header just fade in. */
  reducedFadeMs: 240,
} as const;

/**
 * Nothing on screen yet but the empty day: no message, card or tail. The
 * hero-to-header move triggers when this stops being true, i.e. when the first
 * thing the feed shows arrives (usually the first user message).
 */
export function isQuietDay(input: {
  messageCount: number;
  hasLiveCard: boolean;
  tail: Pick<Tail, 'thinking' | 'accountProgress' | 'fmRefusal' | 'budgetHint'>;
}): boolean {
  return (
    input.messageCount === 0 &&
    !input.hasLiveCard &&
    !input.tail.thinking &&
    !input.tail.accountProgress &&
    !input.tail.fmRefusal &&
    !input.tail.budgetHint
  );
}

/** What can happen to the layout. */
export type LayoutEvent =
  /** Today's rows have been read; `quiet` is whether the day is empty. */
  | { type: 'loaded'; quiet: boolean }
  /** The day stopped being quiet. */
  | { type: 'notQuiet' }
  /** The hero-to-header animation completed. */
  | { type: 'moveFinished' }
  /** The chat day rolled over: back to the empty-day hero. */
  | { type: 'dayReset' };

/**
 * The Assistant's layout phase machine, a pure reducer over events.
 * - `loading`: a neutral empty frame until today's rows are read (never the
 *   hero, which would flash on a day that has messages).
 * - `loaded`: an empty day is the `hero`; a day with rows goes straight to the
 *   `header` with no animation (reopening mid-day).
 * - `notQuiet`: `hero` -> `moving`, the move that plays when the first message
 *   of the day arrives. Ignored in every other phase.
 * - `moveFinished`: `moving` -> `header`.
 * - `dayReset`: any loaded phase -> `hero`, so the move can play again on the new day
 *   (`loading` stays `loading`).
 */
export function layoutPhaseReduce(phase: LayoutPhase, event: LayoutEvent): LayoutPhase {
  switch (event.type) {
    case 'loaded':
      return phase === 'loading' ? (event.quiet ? 'hero' : 'header') : phase;
    case 'notQuiet':
      return phase === 'hero' ? 'moving' : phase;
    case 'moveFinished':
      return phase === 'moving' ? 'header' : phase;
    case 'dayReset':
      // Before the day has loaded there is nothing to reset: `loaded` decides.
      return phase === 'loading' ? 'loading' : 'hero';
  }
}

/** What arrived since `seenCount`. The first look after the load sees nothing:
 *  the stored day is neither announced nor treated as a send. */
export function arrivalsSince(
  state: ChatLogState,
  seenCount: number,
  firstLook: boolean
): { event: 'sent' | 'incoming' | null; xavier: ChatMessage[] } {
  if (firstLook) return { event: null, xavier: [] };
  return {
    event: batchEvent(state, seenCount),
    xavier: state.messages.slice(seenCount).filter((m) => m.role === 'xavier'),
  };
}

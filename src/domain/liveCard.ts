/**
 * The ONE live card (docs/design/xavier-daily-chat-spec.md §6.2). The screen
 * holds each card flow in its own state (a draft, an account confirm, a query
 * answer...). `liveCardOf` collapses them into a single discriminated union, so
 * "is there a live card", "which one do we draw" and "what is ephemeral" have
 * one answer instead of the several that used to disagree.
 *
 * Pure and framework-free: the value types are the caller's (`V`), so the screen
 * keeps its own state types and gets them back narrowed by `kind`.
 */
import type { ChatCardKind } from './chatMessage';

/** The screen's card flows, in precedence order (the first one set wins). */
export const LIVE_KINDS = [
  'draft',
  'account_create',
  'account_update',
  'delete_handoff',
  'query_answer',
  'tx_picker',
  'budget',
] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

/** The chat-log card kinds each screen flow is stored as. */
export const LOG_KINDS_OF: Record<LiveKind, readonly ChatCardKind[]> = {
  draft: ['draft', 'statement_queue'],
  account_create: ['account_create'],
  account_update: ['account_update'],
  delete_handoff: ['delete_handoff'],
  query_answer: ['query_answer'],
  tx_picker: ['tx_picker'],
  budget: ['afford', 'afford_pick', 'set_budget'],
};

export type LiveCard<V extends Record<LiveKind, unknown>> = {
  [K in LiveKind]: { kind: K; value: V[K] };
}[LiveKind];

/** What the screen holds: each flow's value, or null. */
export type ScreenCards<V extends Record<LiveKind, unknown>> = {
  [K in LiveKind]: V[K] | null;
};

export interface LiveCardOptions {
  /** The budget reply is one `budgetCard()` stores. "Open Budget" / "no budgets" are not. */
  budgetReplyStored?: boolean;
}

/** Which flows are set, after the per-flow conditions. */
function activeKinds<V extends Record<LiveKind, unknown>>(
  screen: ScreenCards<V>,
  options: LiveCardOptions,
): LiveKind[] {
  return LIVE_KINDS.filter((kind) => {
    if (screen[kind] === null || screen[kind] === undefined) return false;
    if (kind === 'budget') return options.budgetReplyStored === true;
    return true;
  });
}

export function liveCardOf<V extends Record<LiveKind, unknown>>(
  screen: ScreenCards<V>,
  options: LiveCardOptions = {},
): LiveCard<V> | null {
  const kind = activeKinds(screen, options)[0];
  if (!kind) return null;
  return { kind, value: screen[kind] } as LiveCard<V>;
}

/**
 * A dev-only consistency check: at most one flow set, and the log's newest live
 * card is of that flow's kind. Returns what is wrong (content-free), or null.
 */
export function liveCardProblem<V extends Record<LiveKind, unknown>>(
  screen: ScreenCards<V>,
  options: LiveCardOptions,
  logNewestLiveKind: ChatCardKind | null,
): string | null {
  const active = activeKinds(screen, options);
  if (active.length > 1) return `live_card_many:${active.join('+')}`;
  const [kind] = active;
  if (!kind) return logNewestLiveKind ? `live_card_log_only:${logNewestLiveKind}` : null;
  if (!logNewestLiveKind || !LOG_KINDS_OF[kind].includes(logNewestLiveKind)) {
    return `live_card_kind_mismatch:${kind}/${logNewestLiveKind ?? 'none'}`;
  }
  return null;
}

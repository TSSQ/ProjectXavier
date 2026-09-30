/**
 * Pure visibility rules for the seated composer (docs/design/
 * composer-seated-with-xavier-spec.md §4.3). Framework-free so the BDD suite
 * (composer-state.feature) can pin every branch without mounting the screen.
 *
 * `ComposerSignals` mirrors the handful of `AssistantScreenInner` booleans
 * that already gate the retired quick-action chips and slash popover
 * (`noOverlay`, `busy`, `accountFlow`) plus the two card-pending flags that
 * take the composer off-screen entirely. The caller (index.tsx) computes
 * these exactly as it does today — this module only decides what to show
 * once they're known.
 */
import { isSlashQuery } from './assistantCommands';

export interface ComposerSignals {
  /** A parsed transaction draft card is up (Save/Discard own the moment). */
  pending: boolean;
  /** The /account confirm card is up. */
  pendingAccount: boolean;
  /** The /account Q&A is active (any step) — the field rides with the
   *  question; a commands menu or camera invites abandoning the flow. */
  accountFlow: boolean;
  /** The existing composite idle-gate (index.tsx ~683): false while any
   *  overlay — the draft/account cards above, an account update, a delete
   *  handoff, a query answer, a tx-op picker, or the statement account
   *  choice — owns the screen. */
  noOverlay: boolean;
  /** A parse/save/etc. is in flight. */
  busy: boolean;
  /** The field holds more than whitespace — `draftShape(text).hasText`. */
  typed: boolean;
}

export interface ComposerState {
  /** !pending && !pendingAccount && !busy — those two cards own the whole
   *  moment (a correction goes through their own Edit, not a second
   *  composer), and while Xavier is thinking there is nothing to type into:
   *  the field would only sit there disabled next to the spinner. */
  visible: boolean;
  /** visible && noOverlay && !busy && !accountFlow */
  showPlus: boolean;
  /** visible && !accountFlow && !busy && !typed — only
   *  honoured while the field is empty; a typed character morphs the
   *  trailing slot to Send below regardless of this flag. Hidden while busy
   *  for the same reason "+" is: Send clears the field the instant it is
   *  tapped, so the empty-field branch would otherwise put a camera glyph
   *  next to the parse spinner, and tapping it no-ops. */
  showCamera: boolean;
  /** visible && typed */
  showSend: boolean;
}

export function composerState(s: ComposerSignals): ComposerState {
  const visible = !s.pending && !s.pendingAccount && !s.busy;
  const typed = s.typed;
  return {
    visible,
    showPlus: visible && s.noOverlay && !s.busy && !s.accountFlow,
    showCamera: visible && !s.accountFlow && !s.busy && !typed,
    showSend: visible && typed,
  };
}

/**
 * Everything the Assistant screen needs to know about the composer's text
 * between keystrokes. The text itself lives with the field (DraftComposer)
 * so typing re-renders only the field; the screen re-renders only when this
 * shape changes — the field going from empty to typed or back, or a "/"
 * command query being edited (issue #27: every character used to re-render
 * the whole 4,700-line screen, Xavier and the depth field included).
 */
export interface DraftShape {
  /** More than whitespace — drives Send vs camera, Xavier's typing face, and
   *  the receipt that settles on the first character. */
  hasText: boolean;
  /** The text while it is a slash-command query (isSlashQuery), else null —
   *  the only case the screen needs the characters themselves, to filter the
   *  popover. */
  slashQuery: string | null;
}

export const EMPTY_DRAFT_SHAPE: DraftShape = { hasText: false, slashQuery: null };

export function draftShape(text: string): DraftShape {
  return {
    hasText: text.trim() !== '',
    slashQuery: isSlashQuery(text) ? text : null,
  };
}

export function sameDraftShape(a: DraftShape, b: DraftShape): boolean {
  return a.hasText === b.hasText && a.slashQuery === b.slashQuery;
}

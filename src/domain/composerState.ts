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
  /** The field's current text. */
  draft: string;
}

export interface ComposerState {
  /** !pending && !pendingAccount — those two cards own the whole moment;
   *  a correction goes through their own Edit, not a second composer. */
  visible: boolean;
  /** visible && noOverlay && !busy && !accountFlow */
  showPlus: boolean;
  /** visible && !accountFlow && !busy && draft.trim() === '' — only
   *  honoured while the field is empty; a typed character morphs the
   *  trailing slot to Send below regardless of this flag. Hidden while busy
   *  for the same reason "+" is: Send clears the field the instant it is
   *  tapped, so the empty-field branch would otherwise put a camera glyph
   *  next to the parse spinner, and tapping it no-ops. */
  showCamera: boolean;
  /** visible && draft.trim() !== '' */
  showSend: boolean;
}

export function composerState(s: ComposerSignals): ComposerState {
  const visible = !s.pending && !s.pendingAccount;
  const typed = s.draft.trim() !== '';
  return {
    visible,
    showPlus: visible && s.noOverlay && !s.busy && !s.accountFlow,
    showCamera: visible && !s.accountFlow && !s.busy && !typed,
    showSend: visible && typed,
  };
}

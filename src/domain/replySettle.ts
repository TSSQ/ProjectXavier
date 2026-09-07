/**
 * Reply self-settle rule (composer-seated-with-xavier-spec.md §12 E3). A
 * transient outcome — the confused face after an error/clarify, the happy/
 * angry face after a save — used to sit on screen indefinitely; this decides
 * which outcomes clear themselves and after how long, and whether the same
 * beat also resets the reply TEXT back to the greeting.
 *
 * `saved`/`spent` reset the reply too: their text is a one-off receipt
 * ("Saved! Anything else?") with nothing left to say once the moment has
 * passed. `error`/`clarify` do not — that text is the thing the user still
 * has to read or answer, so only the face (`lastOutcome`) clears; the reply
 * itself is untouched, exactly as before this spec.
 *
 * `cardOwnsScreen` is the other half, and the reason this takes signals
 * rather than a bare outcome. The timer settles whatever the reply happens
 * to say when it fires, but "this is a spent receipt" does not mean "the
 * line on screen is that receipt": while a draft card or a statement queue
 * is up, the line is the queue's own progress ("2 of 6"), set on the way
 * into the next card. Resetting THAT drops the greeting — an invitation to
 * tap a "+" that is not even mounted — over a card the user is still
 * deciding on. So the face still settles, and the text is left alone until
 * the cards are done with the screen.
 *
 * The screen also reuses `resetsReply` for its "typing pre-empts" rule
 * (index.tsx): the first keystroke of a fresh draft settles early rather
 * than waiting out the timer, but only for the kinds this function already
 * marks as reply-resetting — an error/clarify message must never be
 * blanked out from under someone who is in the middle of answering it.
 */
import { AssistantOutcomeKind } from './avatar';

export interface ReplySettleSignals {
  outcome: AssistantOutcomeKind;
  /** A draft card, an account confirm card or a statement queue owns the
   *  screen, so the reply line belongs to that flow, not to the outcome. */
  cardOwnsScreen: boolean;
}

export interface ReplySettleRule {
  /** Whether `lastOutcome` clears itself at all. */
  settles: boolean;
  /** ms until it clears — meaningful only when `settles`. */
  delayMs: number;
  /** Whether the same beat also resets `reply` to the greeting. */
  resetsReply: boolean;
}

const NONE: ReplySettleRule = { settles: false, delayMs: 0, resetsReply: false };

export function replySettleRule({ outcome, cardOwnsScreen }: ReplySettleSignals): ReplySettleRule {
  switch (outcome) {
    case 'saved':
    case 'spent':
      return { settles: true, delayMs: 5000, resetsReply: !cardOwnsScreen };
    case 'error':
    case 'clarify':
      return { settles: true, delayMs: 4000, resetsReply: false };
    default:
      return NONE;
  }
}

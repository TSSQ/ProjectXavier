/**
 * Face self-settle rule (composer-seated-with-xavier-spec.md §12 E3, changed by
 * docs/design/xavier-daily-chat-spec.md §6.4). A transient outcome - the
 * confused face after an error/clarify, the happy/angry face after a save -
 * used to sit on screen indefinitely; this decides which outcomes clear
 * themselves and after how long.
 *
 * It settles ONLY Xavier's face (`lastOutcome`). Before the chat, a save also
 * reset the single reply line to the greeting after 5s; now every reply and
 * receipt is a message in the day's feed and stays in the history, so there is
 * no reply text to reset and typing never clears anything.
 */
import { AssistantOutcomeKind } from './avatar';

export interface ReplySettleRule {
  /** Whether `lastOutcome` clears itself at all. */
  settles: boolean;
  /** ms until it clears - meaningful only when `settles`. */
  delayMs: number;
}

const NONE: ReplySettleRule = { settles: false, delayMs: 0 };

export function replySettleRule({ outcome }: { outcome: AssistantOutcomeKind }): ReplySettleRule {
  switch (outcome) {
    case 'saved':
    case 'spent':
      return { settles: true, delayMs: 5000 };
    case 'error':
    case 'clarify':
      return { settles: true, delayMs: 4000 };
    default:
      return NONE;
  }
}

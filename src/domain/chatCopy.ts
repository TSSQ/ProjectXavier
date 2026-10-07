/**
 * Words for the chat log's collapsed cards (docs/design/xavier-daily-chat-spec.md
 * §6.2). Pure and framework-free. A card that was not acted on collapses to a
 * one-line dashed stub in the kind's own wording; a card whose data moved on
 * adds " · out of date". Cards that resolve are hidden (their receipt takes
 * over), and a query answer never stubs: it stays as history.
 */
import { ACCOUNT_UPDATE_CANCELLED_TEXT, DISCARDED_TEXT } from './bubbleCopy';
import type { ChatMessage, ChatStatus } from './chatMessage';

export const STUB_OUT_OF_DATE = ' · out of date';

/** The label a photo message stores (never the image). */
export const PHOTO_LABELS = {
  receipt: '📷 Receipt',
  statement: '📷 Statement',
  unreadable: '📷 Photo',
} as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stub line for a card that collapsed, or null when the card does not stub
 *  (a non-card, a query answer, or a status that is not abandoned/stale). */
export function stubTextFor(message: ChatMessage): string | null {
  const status: ChatStatus = message.status;
  if (status !== 'abandoned' && status !== 'stale') return null;
  const base = stubBase(message);
  if (base === null) return null;
  return status === 'stale' ? `${base}${STUB_OUT_OF_DATE}` : base;
}

function stubBase(m: ChatMessage): string | null {
  switch (m.kind) {
    case 'draft':
      return `${cap(m.payload.type)} · not saved`;
    case 'account_create':
      return `Account "${m.payload.name}" · not created`;
    case 'account_update':
      return `Account "${m.payload.currentName}" · not changed`;
    case 'afford':
      return 'Budget check · no action taken';
    case 'afford_pick':
      return 'Budget check · no budget chosen';
    case 'set_budget':
      return 'Budget change · not made';
    case 'delete_handoff':
      return 'Delete · cancelled';
    case 'tx_picker':
      return m.payload.op === 'delete' ? 'Transactions · nothing deleted' : 'Transactions · nothing changed';
    case 'statement_queue':
      return `Statement · ${m.payload.saved} of ${m.payload.total} saved`;
    default:
      // user_text, user_photo, xavier_text, xavier_receipt, query_answer.
      return null;
  }
}

/** What Xavier says after Discard / Cancel / Not now on a card of this kind. */
export function dismissTextFor(kind: ChatMessage['kind']): string {
  return kind === 'account_update' ? ACCOUNT_UPDATE_CANCELLED_TEXT : DISCARDED_TEXT;
}

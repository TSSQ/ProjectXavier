/**
 * The prompt text for BYOK worked examples (./workedExamples) — split out so
 * ./deviceParsePrompt can format them without importing ./phraseMemory
 * (which imports ./deviceParsePrompt). Pure, no imports beyond types.
 */
import { TransactionType } from './types';

/** One example: the user's words and the fields they ended up with ('' for none). */
export interface WorkedExample {
  phrase: string;
  type: TransactionType;
  category: string;
  payee: string;
  account: string;
}

/** "Example: <phrase> → type/category/payee/account", '-' for an empty field. */
export function formatWorkedExample(ex: WorkedExample): string {
  const field = (s: string) => s.trim() || '-';
  return `Example: ${ex.phrase} → ${ex.type}/${field(ex.category)}/${field(ex.payee)}/${field(ex.account)}`;
}

/** The prompt block for `examples` ('' for none): a one-line lead, then one
 *  example per line, ending in a newline so the prompt continues below it. */
export function workedExamplesBlock(examples: readonly WorkedExample[]): string {
  if (examples.length === 0) return '';
  return (
    'How this user filed earlier entries (type/category/payee/account; follow the same choices for similar text):\n' +
    examples.map(formatWorkedExample).join('\n') +
    '\n'
  );
}

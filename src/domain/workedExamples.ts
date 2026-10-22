/**
 * BYOK worked examples — the user's own recent corrections as few-shot
 * examples in the CLOUD expense prompt (`buildCloudParsePrompt`,
 * ./deviceParsePrompt). Pure and framework-free (BDD-tested in plain Node).
 *
 * Phrase memory (./phraseMemory) already applies what the user confirmed for
 * the SAME words after a parse. This shows a cloud model how this user files
 * OTHER words — "kopi at ya kun → expense/Food/Ya Kun/Cash" — so a new phrase
 * can follow the same habits. Up to `MAX_WORKED_EXAMPLES` of the most
 * recently used phrase rows, each as its key (the user's words minus amount
 * and date) and the final type / category / payee / account names.
 *
 * Off by default (`byok_worked_examples`, src/features/settings/repository.ts)
 * until the cloud eval's `--examples` arm (evals/README.md, "Worked
 * examples") says it helps. Never in the on-device prompt: only
 * `buildCloudParsePrompt` reads them, and `buildFmParsePrompt` never does.
 *
 * Content: the phrases are the user's own words, sent only to their own BYOK
 * provider with their own key, like the rest of the prompt; never logged.
 */
import { Account, Category, Payee } from './types';
import { PhraseMemoryRow, isQueryTermKey } from './phraseMemory';
import type { WorkedExample } from './workedExamplePrompt';

export type { WorkedExample } from './workedExamplePrompt';
export { formatWorkedExample, workedExamplesBlock } from './workedExamplePrompt';

/** At most this many examples go into one prompt. */
export const MAX_WORKED_EXAMPLES = 5;

export interface WorkedExampleLists {
  categories: readonly Category[];
  payees: readonly Payee[];
  accounts: readonly Account[];
}

const nameOf = (list: ReadonlyArray<{ id: string; name: string }>, id: string | null): string =>
  (id && list.find((e) => e.id === id)?.name) || '';

/**
 * The examples phrase memory gives: transaction phrases only (never a
 * question term), with a remembered type, not a "don't log these words"
 * verdict, most recently used first, at most `max`. Ids that no longer
 * exist become ''; a row left with no category, payee or account says
 * nothing beyond its type and is skipped. `excludeKey` (the text being
 * parsed) is never its own example.
 */
export function workedExamplesFromMemory(
  rows: readonly PhraseMemoryRow[],
  lists: WorkedExampleLists,
  { max = MAX_WORKED_EXAMPLES, excludeKey = '' }: { max?: number; excludeKey?: string } = {}
): WorkedExample[] {
  const out: WorkedExample[] = [];
  const ordered = [...rows].sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  for (const r of ordered) {
    if (out.length >= max) break;
    if (!r.key || r.key === excludeKey || isQueryTermKey(r.key) || r.verdict === 'not_log' || !r.type) continue;
    const ex: WorkedExample = {
      phrase: r.key,
      type: r.type,
      category: nameOf(lists.categories, r.categoryId),
      payee: nameOf(lists.payees, r.payeeId),
      account: nameOf(lists.accounts, r.accountId),
    };
    if (!ex.category && !ex.payee && !ex.account) continue;
    out.push(ex);
  }
  return out;
}

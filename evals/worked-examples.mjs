/**
 * The cloud eval's worked-examples arm (dev tooling — never ships; see
 * evals/README.md "Worked examples"). The app's examples come from phrase
 * memory (src/domain/workedExamples.ts), which the eval does not have, so for
 * each case they are SYNTHESISED from up to `MAX_WORKED_EXAMPLES` OTHER dev
 * cases that share its context (same category / payee / account lists):
 *
 *   - never the case itself, nor another case whose phrase key equals it
 *     (the app never shows the phrase being parsed as its own example);
 *   - only dev cases (a holdout label never leaks into any prompt), only real
 *     transactions (`expected` not null) that assert a category or payee — a
 *     label that asserts neither says nothing beyond the type;
 *   - the phrase is the case's own phrase key (`phraseKey`, the same key a
 *     memory row has: the words minus amount and date), the fields its label;
 *     a label the case leaves unasserted (null) is written as '' ('-');
 *   - picked in a fixed per-case order (sha256 of the two ids), so a re-run
 *     sends the same prompt.
 *
 * Runs under tsx (imports the app's TypeScript).
 */
import { createHash } from 'node:crypto';
import { phraseKey } from '../src/domain/phraseMemory.ts';
import { MAX_WORKED_EXAMPLES } from '../src/domain/workedExamples.ts';

/** The lists that decide a context: two cases share one when these match. */
export function contextKey(context) {
  const { categories = [], payees = [], accounts = [] } = context ?? {};
  return JSON.stringify({ categories, payees, accounts });
}

const nowOf = (c) => (c.context?.nowISO ? Date.parse(c.context.nowISO) : Date.now());
const order = (a, b) => createHash('sha256').update(`${a}\n${b}`).digest('hex');

/**
 * Worked examples for case `c` from `pool` (every dataset case; only dev ones
 * are used). Returns `WorkedExample`s for `buildCloudParsePrompt`.
 */
export function syntheticWorkedExamples(c, pool, { max = MAX_WORKED_EXAMPLES } = {}) {
  const key = contextKey(c.context);
  const ownPhrase = phraseKey(c.text, nowOf(c));
  return pool
    .filter((o) => o.id !== c.id && o.split === 'dev' && o.expected && (o.expected.category || o.expected.payee))
    .filter((o) => contextKey(o.context) === key)
    .map((o) => ({ o, phrase: phraseKey(o.text, nowOf(o)) }))
    .filter(({ phrase }) => phrase && phrase !== ownPhrase)
    .sort((x, y) => (order(c.id, x.o.id) < order(c.id, y.o.id) ? -1 : 1))
    .slice(0, max)
    .map(({ o, phrase }) => ({
      phrase,
      type: o.expected.sign,
      category: o.expected.category ?? '',
      payee: o.expected.payee ?? '',
      account: '',
    }));
}

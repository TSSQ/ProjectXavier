/**
 * Prompt arms for the question eval (dev tooling — never ships; see
 * evals/README.md "Questions", D4 A/B). Instructions and schema never vary by
 * arm — only the user turn (FM) or the tool parameter schemas (cloud).
 *
 *   fm     baseline          the shipping prompt, `Question: <text>`
 *          known-categories  + one capped "Known categories: …" line
 *                            (`knownCategoriesFor`, forced on for the arm;
 *                            the app keeps it behind
 *                            QUERY_SELECTION_KNOWN_CATEGORIES_ENABLED)
 *   cloud  closed            category/payee/account a closed choice of the
 *                            user's names + "unspecified" (queryToolChoices.ts)
 *          free              the static free-text tool definitions
 */
import { buildQueryToolSelectionPrompt, knownCategoriesFor } from '../src/domain/queryToolSelection.ts';
import { ledgerUsage } from './questions-score.mjs';

export const FM_ARMS = ['baseline', 'known-categories'];
export const CLOUD_ARMS = ['closed', 'free'];

/** The FM user turn for `arm`, or `undefined` for the shipping prompt. */
export function fmPromptForArm(arm, c, ledger) {
  if (arm === 'baseline') return undefined;
  if (arm === 'known-categories') {
    const knownCategories = knownCategoriesFor(c.text, ledger.categories, ledgerUsage(ledger), { force: true });
    return buildQueryToolSelectionPrompt(c.text, { knownCategories });
  }
  throw new Error(`unknown fm arm "${arm}"`);
}

/** The cloud loop options for `arm`. */
export function cloudOptionsForArm(arm, ledger) {
  if (arm === 'free') return {};
  if (arm === 'closed') {
    return {
      grounding: { categories: ledger.categories, payees: ledger.payees, accounts: ledger.accounts, usage: ledgerUsage(ledger) },
    };
  }
  throw new Error(`unknown cloud arm "${arm}"`);
}

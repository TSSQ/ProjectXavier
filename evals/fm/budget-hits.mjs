#!/usr/bin/env node
/**
 * Runs the budget-command router (src/domain/budgetIntent.ts) and the model
 * fallback trigger (src/domain/budgetFm.ts) over the DEV split (dev tooling -
 * never ships, no model).
 *
 *   npx tsx evals/fm/budget-hits.mjs          # human table
 *   npx tsx evals/fm/budget-hits.mjs --json   # machine-readable (test-budget-routes.mjs)
 *
 * `falsePositives` must stay empty: a budget route (any kind) or an FM
 * candidate on a case whose expected label is a transaction. Each case is
 * tried against its OWN categories and against a broad set that includes
 * every name a spend could plausibly share with a budget ("Food", "Hotel",
 * "Coffee"...). Dev only: it never reads holdout or holdout2 cases.
 */
import { loadCases } from '../split.mjs';
import { detectBudgetIntent } from '../../src/domain/budgetIntent.ts';
import { budgetFmCandidate } from '../../src/domain/budgetFm.ts';

const BROAD = [
  'Food', 'Dining', 'Groceries', 'Transport', 'Shopping', 'Rent', 'Hotel', 'Coffee', 'Travel',
  'Entertainment', 'Bills', 'Health', 'Gas', 'Utilities', 'Personal Care', 'Taxi', 'Lunch', 'Dinner',
].map((name) => ({ id: name.toLowerCase(), name, kind: 'expense', parentId: null, icon: null }));

const own = (c) =>
  (c.context?.categories ?? [])
    .filter((x) => x.kind === 'expense')
    .map((x) => ({ id: x.name.toLowerCase(), name: x.name, kind: 'expense', parentId: null, icon: null }));

export function budgetHitsOnDev() {
  const cases = loadCases('dev');
  const falsePositives = [];
  let refusalRoutes = 0;
  for (const c of cases) {
    const routes = [own(c), BROAD]
      .map((cats) => detectBudgetIntent(c.text, cats))
      .filter((i) => i && i.kind !== 'afford');
    const fm = budgetFmCandidate(c.text);
    if (c.expected !== null) {
      if (routes.length > 0 || fm) {
        falsePositives.push({ id: c.id, text: c.text, route: routes[0]?.kind ?? null, fmCandidate: fm });
      }
    } else if (routes.length > 0) {
      refusalRoutes += 1;
    }
  }
  return { cases: cases.length, falsePositives, refusalRoutes };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const r = budgetHitsOnDev();
  console.log(process.argv.includes('--json') ? JSON.stringify(r) : JSON.stringify(r, null, 2));
}

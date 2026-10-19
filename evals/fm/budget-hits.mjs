#!/usr/bin/env node
/**
 * Runs the budget-command router (src/domain/budgetIntent.ts) and the model
 * fallback trigger (src/domain/budgetFm.ts) over the DEV split (dev tooling -
 * never ships, no model).
 *
 *   npx tsx evals/fm/budget-hits.mjs          # human table
 *   npx tsx evals/fm/budget-hits.mjs --json   # machine-readable (test-budget-routes.mjs)
 *
 * `falsePositives` must stay empty: a budget route or an FM candidate on a case
 * whose expected label is a transaction. Not counted: a "budget-or-spend"
 * answer (a question, nothing is logged or hijacked), and the named cases in
 * ACCEPTED_ROUTES below. Each case is
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

/** Dev cases whose route is accepted on purpose, by id, with the reason. An accepted
 *  case is exempt only when EVERY route it gets is a set-budget and no FM candidate
 *  fires; any other signal on it is still reported. */
export const ACCEPTED_ROUTES = {
  // "Budget 30 lunch": with the BROAD list "Lunch" is an existing category, so the
  // bare "budget <amount> <category>" form is a set-budget (product decision).
  'dv-cue-52': 'exact-category bare form is a set-budget',
};

const isAccepted = (id, routes, fm, accepted) =>
  id in accepted && !fm && routes.length > 0 && routes.every((i) => i.kind === 'set-budget');

const own = (c) =>
  (c.context?.categories ?? [])
    .filter((x) => x.kind === 'expense')
    .map((x) => ({ id: x.name.toLowerCase(), name: x.name, kind: 'expense', parentId: null, icon: null }));

export function budgetHitsOnDev(cases = loadCases('dev'), accepted = ACCEPTED_ROUTES) {
  const falsePositives = [];
  let refusalRoutes = 0;
  for (const c of cases) {
    const routes = [own(c), BROAD]
      .map((cats) => detectBudgetIntent(c.text, cats))
      .filter((i) => i && i.kind !== 'afford' && i.kind !== 'budget-or-spend');
    const fm = budgetFmCandidate(c.text);
    if (c.expected !== null) {
      if ((routes.length > 0 || fm) && !isAccepted(c.id, routes, fm, accepted)) {
        falsePositives.push({ id: c.id, text: c.text, route: routes[0]?.kind ?? null, fmCandidate: fm });
      }
    } else if (routes.length > 0) {
      refusalRoutes += 1;
    }
  }
  return { cases: cases.length, falsePositives, refusalRoutes };
}

/** A spend that an exact category turns into a set-budget, with nothing accepted:
 *  the check that such a hijack is still surfaced (read by test-budget-routes.mjs). */
export function syntheticHijack() {
  const spend = {
    id: 'synthetic-1',
    text: 'budget 30 lunch',
    expected: { amount: 30 },
    context: { categories: [{ name: 'Lunch', kind: 'expense' }] },
  };
  return budgetHitsOnDev([spend], {});
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const r = { ...budgetHitsOnDev(), synthetic: syntheticHijack() };
  console.log(process.argv.includes('--json') ? JSON.stringify(r) : JSON.stringify(r, null, 2));
}

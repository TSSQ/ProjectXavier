/**
 * Deterministic period-token resolver for Ask-Xavier queries
 * (docs/design/ask-xavier-queries-spec.md §5.2). The model NEVER produces a
 * date or a date range — it only ever emits one of the tokens below
 * (`src/domain/queryToolSelection.ts`'s selection contract, and the BYOK tool
 * loop's per-tool params, both constrain "period" to this enum); this module
 * is the ONE place a token turns into a real epoch range, mirroring
 * `src/domain/deviceParsePrompt.ts`'s `resolveRelativeDate`/
 * `resolveAbsoluteDate` split (deterministic code owns dates, never the
 * model).
 *
 * Pure and TZ-safe: `now` is always injected by the caller (never
 * `Date.now()` read in here), and every calculation is built on
 * `src/domain/period.ts`'s existing local-calendar helpers
 * (`periodRange`/`startOfPeriod`) — the same "local time, epoch ms, end
 * exclusive" convention the dashboard's drill-down already uses, so a
 * period resolved here always matches what the dashboard would show for the
 * same range.
 */
import { periodRange, startOfPeriod, PeriodRange, Granularity } from './period';

/** The only period shapes the model may ever choose — every one of these
 *  maps onto a real, unambiguous calendar range for a given `now`. Order is
 *  irrelevant (this is just the type source); see `PERIOD_TOKENS` below for
 *  runtime membership checks (e.g. the query tool-selection schema's enum). */
export const PERIOD_TOKENS = [
  'this_month',
  'last_month',
  'this_week',
  'last_week',
  'this_year',
  'last_year',
  'all_time',
] as const;

export type PeriodToken = (typeof PERIOD_TOKENS)[number];

/** Granularity `periodRange` needs for each non-`all_time` token — used only
 *  to walk to the PREVIOUS period for the `last_*` tokens. */
const GRANULARITY_FOR: Record<Exclude<PeriodToken, 'all_time'>, Granularity> = {
  this_month: 'month',
  last_month: 'month',
  this_week: 'week',
  last_week: 'week',
  this_year: 'year',
  last_year: 'year',
};

/** True when `token` is actually one of `PERIOD_TOKENS` at runtime — `token`
 *  is typed `PeriodToken` above, but an UNTRUSTED caller (a BYOK tool call
 *  whose params only shape-checked, not schema-validated — see the QA
 *  blocker note below) can hand this function a value the type system never
 *  really guaranteed. */
function isKnownPeriodToken(token: unknown): token is PeriodToken {
  return typeof token === 'string' && (PERIOD_TOKENS as readonly string[]).includes(token);
}

/**
 * Resolve a period token to a concrete `[start, end)` epoch-ms range for the
 * given `now`. `last_*` tokens step back one calendar unit by taking the
 * current period's start and subtracting 1ms — landing inside the previous
 * period — then re-deriving that period's own full range, so a `last_month`
 * asked on the 1st of the month still resolves to the WHOLE previous month,
 * not a zero-length range. `all_time` has no calendar boundary: `start` is
 * epoch 0 and `end` is `now + 1` (exclusive-end convention, so a transaction
 * occurring at exactly `now` is still included).
 *
 * ── QA BLOCKER follow-up: never throw on a missing/unknown token ──────────
 * A BYOK tool call missing `period` entirely used to reach
 * `token.startsWith('last_')` with `token === undefined` and THROW — this
 * function is on the direct call path from `src/domain/queryTools.ts`'s
 * executors, which the BYOK tool loop (`src/features/ai/queryLoop.ts`) calls
 * with model-supplied params; "never throws (null -> fall through)" is that
 * loop's whole contract, so a throw here broke it. `isKnownPeriodToken`
 * rejects anything that isn't truly a member of `PERIOD_TOKENS` and falls
 * back to `this_month` — the same "assume this_month is a reasonable
 * default" convention `queryToolSelection.ts` already documents for its own
 * missing-period case, so the fallback behavior is consistent across every
 * caller regardless of which engine (FM, BYOK, floor) produced the call.
 */
export function resolvePeriodRange(token: PeriodToken, now: number): PeriodRange {
  if (!isKnownPeriodToken(token)) return periodRange(now, 'month');
  if (token === 'all_time') return { start: 0, end: now + 1 };

  const granularity = GRANULARITY_FOR[token];
  if (token.startsWith('last_')) {
    const previousInstant = startOfPeriod(now, granularity) - 1;
    return periodRange(previousInstant, granularity);
  }
  return periodRange(now, granularity);
}

/**
 * Model-facing display formatting for Ask-Xavier tool results
 * (docs/design/ask-xavier-queries-spec.md §5.3) — QA device bug (build 56):
 * the BYOK tool loop (`src/features/ai/queryLoop.ts`) was handing the model
 * the tool result's raw `amountMinor` (minor units/cents — `5000` for
 * "SGD 50.00") for it to narrate, and the model dutifully read the raw
 * integer back as if it were a major-unit amount ("Your total spending is
 * 5,000"). The CARD was always right (it reads the SAME raw result through
 * the app's own formatter) — only the model-facing copy lied.
 *
 * `formatAmountsForModel` walks a tool result (any of the 7 tools' shapes —
 * top-level `amountMinor`, or nested in `slices[]`/`series[]`/`rows[]`,
 * generically, with no per-tool special-casing needed) and replaces every
 * `amountMinor: <minor-unit integer>` field with `amount: <formatted
 * string>` — so the model only ever sees an already-correct, already-
 * formatted display value ("SGD 50.00") and is instructed (see
 * `queryLoopPrompt.ts`) to restate it verbatim rather than recompute
 * anything. `call.result` (what the CARD renders from) is left completely
 * untouched by the caller — this transform is ONLY ever applied to the
 * copy serialized into the model-facing `tool_result`/`tool` message
 * content.
 *
 * Currency-decimals-aware: a 0-decimal currency (JPY, KRW, …) has NO minor
 * unit at all — `amountMinor` for those IS the major-unit amount, so
 * dividing by 100 would be 100x wrong the other way. This module used to
 * carry its OWN small ISO 4217 exponent table because, at the time it was
 * written, `src/domain/money.ts`'s currency-aware ÷10**exponent rework had
 * landed on a sibling branch, not here yet. That rework (`currencyExponent`,
 * `formatMoney` — src/domain/currency.ts / money.ts) is now the single
 * shared source of truth after merging main, so this module just calls
 * `formatMoney` directly instead of duplicating the exponent table.
 */
import { formatMoney } from './money';

/** Format a single minor-unit amount as a locale-formatted currency string
 *  for the model to read (and restate verbatim — never recompute). Falls
 *  back to a plain fixed-point string (still scaled by the right exponent)
 *  if `currency` isn't a valid ISO code `Intl.NumberFormat` accepts (e.g. a
 *  corrupted/legacy value) — never throws (formatMoney already guarantees
 *  this). */
function formatAmountForModel(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor, currency);
}

/**
 * Deep-walk `result` (a tool executor's return value — see
 * `src/domain/queryTools.ts`), replacing every `amountMinor` field
 * (top-level, or nested inside `slices`/`series`/`rows` arrays — walked
 * generically, not by name) with a display-formatted `amount` string in
 * `currency`. Every other field (labels, names, counts, notes, period
 * tokens) passes through unchanged. Pure, never throws, and never mutates
 * its input — always returns a new value.
 */
export function formatAmountsForModel(result: unknown, currency: string): unknown {
  if (Array.isArray(result)) {
    return result.map((item) => formatAmountsForModel(item, currency));
  }
  if (result && typeof result === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (key === 'amountMinor' && typeof value === 'number') {
        out.amount = formatAmountForModel(value, currency);
      } else {
        out[key] = formatAmountsForModel(value, currency);
      }
    }
    return out;
  }
  return result;
}

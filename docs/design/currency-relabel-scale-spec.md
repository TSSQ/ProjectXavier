# Spec: single-currency relabel + currency-aware scale (review F1 / M7)

Supersedes the freeze-based approach in `currency-freeze-integrity-spec.md`
(that proposed locking the currency + a repair flow). Per the user's decision,
the app stays **single-currency** but the currency is **changeable via an
explicit consented relabel** (not frozen), and the ×100 scale is made
**currency-aware** so zero/three-decimal currencies are correct.

## Objective
1. Make the single-currency constraint real: the ledger is always in ONE
   currency (no mixing). Changing the currency **relabels every amount** to the
   new code — it does NOT convert (SGD 1,000 → USD 1,000). If any data exists,
   changing requires an explicit warning + consent. This removes both halves of
   F1: the relabel is no longer silent, and the ledger can never be mixed.
2. Fix the money scale: replace the hard-coded ×100 (2-decimal assumption) with
   a currency-aware minor-unit exponent, so JPY/KRW/VND/CLP (0-decimal) — and
   any 3-decimal currency — store, format, and input correctly.

## Product decisions (already made by the user — do not re-litigate)
- Relabel, NOT convert. No FX, no rates, no network. Stays fully local.
- Change is allowed anytime; only **warn + confirm when transactions/accounts
  exist**. Empty ledger → change freely.
- Full 0/2/3-decimal support now (not gating the currency list to 2-decimal).

## HARD CONSTRAINTS
- Branch `claude/critical-fixes-f1-f3` (in the primary checkout). NEVER main.
  Joins F2 (37d6a8c) + F3 (bbdff85); the store build will carry F1+F2+F3.
- Guardrail #4: the relabel writes MUST be parameterised (no value
  concatenation). Guardrail #1: backup/restore round-trip must still hold.
  Guardrail #6: validate at trust boundaries.
- The relabel is a financial mutation → it MUST call `bumpDataRevision()` (F3)
  so a backup is triggered afterward.

## Scope
IN:
1. **Currency exponent** — a pure `currencyExponent(code: string): 0 | 2 | 3` in
   a new `src/domain/currency.ts` (or extend `money.ts`), driven by an ISO 4217
   table for every code in `SUPPORTED_CURRENCIES`. Known 0-decimal in the
   current list: **JPY, KRW, VND, CLP**. Everything else in the list is 2.
   (No 3-decimal currency is in the list today, but support 3 generally — e.g.
   BHD/KWD/OMR/TND — so a future add is correct.) Default to 2 for an unknown
   code (defensive), never throw.
2. **Currency-aware money math** — `src/domain/money.ts`:
   - `toMinorUnits(major, currency)` = `Math.round(major * 10 ** exp)`.
   - `toMajorUnits(minor, currency)` = `minor / 10 ** exp`.
   - `formatMoney(minor, currency, locale?)` divides by `10 ** exp` before
     `Intl.NumberFormat` (Intl already renders the right fraction digits per
     currency; the divisor is what's currently wrong). Thread `currency` through
     every caller (single-currency → callers pass the current `getCurrency()`
     value or the row's `currency`). Keep a clear default so the diff is
     mechanical.
3. **Amount keypad** (`src/components/ui/AmountKeypad.tsx`) — respect the
   exponent: 0-decimal → integer-only (no decimal key / block a decimal point),
   2 → 2 places, 3 → 3 places. The keypad must know the active currency.
4. **Change-currency relabel** — a domain operation + a repository action:
   - Pure helper `rescaleMinor(minor, fromExp, toExp)` =
     `Math.round(minor * 10 ** (toExp - fromExp))` (identity when equal;
     rounds when the target has fewer decimals — inherent, e.g. SGD 1,000.50 →
     JPY ¥1,001).
   - `relabelCurrency(newCode)` in the repository layer: in ONE
     `db.transaction`, set `currency = newCode` on every accounts /
     transactions / recurring-template row AND rescale each stored `amount`
     (and account `openingBalance`) by `rescaleMinor(.., oldExp, newExp)` when
     `oldExp !== newExp`; update the `currency` setting; call
     `bumpDataRevision()` once. Parameterised statements only.
   - `canChangeCurrencyFreely()` = true only when there is NO account and NO
     transaction (truly empty). Otherwise the change goes through the confirm.
5. **Settings UI** — the currency control:
   - Empty ledger: normal picker, applies immediately (still calls
     `relabelCurrency` for consistency; no-op rescale, nothing to relabel).
   - Non-empty: picking a new currency opens a **warning modal** that states, in
     plain words, that amounts are **relabelled, not converted** — with a
     concrete before→after example using the user's real total (e.g. "Your
     balances stay the same numbers: 4,200.00 becomes ¥4,200"), and, when the
     exponent shrinks, that fractional cents are rounded. Only on explicit
     confirm does it call `relabelCurrency`. Cancel changes nothing.
6. **Swift widget** (`targets/widget/WidgetSummary.swift`) — format with
   `NumberFormatter` `numberStyle = .currency` + the stored currency code
   (auto-exponent), and convert minor→major by the currency's exponent, not
   `/100`. Confirm the widget's stored summary carries the currency so it can
   format correctly.
7. **Parse pipeline scale (FM + Claude/BYOK + heuristic)** — the parsers convert
   the model's MAJOR-unit amount to minor units with a hard-coded ×100 too, so
   they carry the same bug:
   - `toUsableAmount` in `src/domain/deviceParsePrompt.ts` (`Math.round(n * 100)`)
     is used by `normalizeDeviceParseOutput`, which BOTH the on-device FM path
     (`src/features/ai/deviceParse.ts`) AND the cloud path
     (`src/features/ai/engines/shared.ts runCloudParse`) call — fix once here.
   - the heuristic `src/domain/localParse.ts` extracts an amount and ×100s it too
     — fix there as well.
   Make these use `toMinorUnits(major, currency)` for the active currency. Thread
   the current currency (single-currency → `getCurrency()`) into the parse
   context/normalize so the amount is scaled to the right exponent (JPY "coffee
   500" → 500 minor = ¥500, not ¥50,000). The downstream
   `aiParsedExpenseSchema`/interpret/createTransaction path is unchanged (it just
   stores the minor units the parser now produces correctly).
8. Tests (`tests/`, plain Node) for all pure pieces (below).

OUT:
- Multi-currency (per-account currencies, per-transaction override, FX/rates) —
  a separate future epic; this stays single-currency.
- Historical FX / conversion of any kind.
- Changing the stored integer representation (still integer minor units; only
  the per-currency exponent changes what "minor" means).

## Acceptance criteria
1. `currencyExponent` returns the correct ISO exponent for a representative
   sample (JPY/KRW/VND/CLP → 0; USD/EUR/SGD/GBP → 2; a 3-decimal dinar → 3;
   unknown → 2, no throw). Assert every code in `SUPPORTED_CURRENCIES` resolves
   to a sane 0/2/3.
2. `toMinorUnits`/`toMajorUnits` round-trip per currency: 2-decimal ×100,
   0-decimal ×1, 3-decimal ×1000 (e.g. `toMinorUnits(1000, 'JPY') === 1000`,
   `toMinorUnits(12.34, 'USD') === 1234`, `toMinorUnits(1.234, 'KWD') === 1234`).
3. `formatMoney` renders the right fraction digits per currency (JPY → "¥1,000"
   no decimals; USD → "$1,000.00"; a 3-decimal → 3 places).
4. `rescaleMinor`: identity when exponents equal; SGD→JPY `100000 → 1000`
   (¥1,000, number preserved); rounds on shrink (`100050 → 1001`); JPY→SGD
   `1000 → 100000`.
5. Relabel behaviour (domain-level, with a fake/isolated store where possible):
   same-exponent relabel preserves stored integers + rewrites codes;
   cross-exponent rescales so the displayed number is preserved; the ledger is
   single-currency afterward (all rows share `newCode`); `bumpDataRevision` is
   called exactly once.
6. `canChangeCurrencyFreely` true only when empty (no accounts, no
   transactions); false otherwise.
7. **Parse scale**: `normalizeDeviceParseOutput` (shared by FM + cloud) and
   `localParse` produce minor units at the ACTIVE currency's exponent — a
   labelled dataset amount like `500` yields `50000` for USD but `500` for JPY.
   Test via the pure `normalizeDeviceParseOutput`/`localParse` with a currency
   in context (both AI engines and the heuristic funnel through these, so a pure
   test covers all three). Existing parse tests still pass under the default
   (2-decimal) currency.
8. Node suite green (`typecheck && lint && test`); new scenarios cover 1–7.
   Backup round-trip tests still pass (guardrail #1). No secret/PII logging.
8. Device-confirm (carried to the build): pick JPY on an empty ledger → enter
   ¥1,000 (keypad has no decimals) → shows ¥1,000 (not ¥100,000); widget shows
   ¥1,000. Change SGD→USD with data → warning modal (relabel-not-convert copy) →
   confirm → all amounts keep their numbers with USD label; a new backup is
   produced on next backgrounding (F3 interplay).

## Edge cases
- **Rounding on exponent shrink** (2/3-decimal → 0-decimal): fractional minor
  units are rounded; the modal must say so. This is inherent to re-denominating
  into a lower-precision currency, not a bug.
- **Opening balances** (`accounts.openingBalance`) are minor units too — rescale
  them in the same relabel pass.
- **Recurring templates** carry `amount` + `currency` — relabel + rescale them
  in the same transaction (else a future occurrence posts in the old scale).
- **updateWidgetSummary** writes amounts for the widget — it must write in the
  current currency + carry the code so the widget formats correctly after a
  relabel.
- **Keypad already-typed value** when currency changes: not reachable in the
  single-currency flow (currency changes from Settings, not mid-entry), but the
  keypad must read the active exponent at mount.
- **Unknown/legacy currency code** in a restored backup: `currencyExponent`
  defaults to 2, never throws; formatting degrades gracefully.

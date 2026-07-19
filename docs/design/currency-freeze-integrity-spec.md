# Spec: currency freeze + mixed-ledger integrity (review F1 / M7)

Fixes the confirmed critical from the 2026-07-18 repo review. The app is
single-currency by design (store doc M7: "accepted design constraint"), but
Settings offers 46 switchable currencies and `setCurrency` writes only the
settings row — existing accounts, transactions, and recurring templates keep
their old `currency` values while every total, chart, forecast, and the widget
relabel and mix them with no conversion (`src/features/settings/repository.ts`,
`src/domain/period.ts` is currency-blind, `app/(tabs)/dashboard.tsx:58` formats
everything with the one global code). A SGD 1,000 ledger switched to JPY
displays as ¥1,000. Zero-decimal currencies (JPY, KRW, VND, CLP are all in
`SUPPORTED_CURRENCIES`) additionally accept fractional input over the
hard-coded two-decimal scale (`src/domain/money.ts:6-13`), and the widget
formats every currency with exactly two decimals
(`targets/widget/WidgetSummary.swift:73-84`).

This spec makes the single-currency constraint *real* — freeze, detect, resolve
— without FX, without changing the stored ×100 minor-unit scale, and without a
data migration. It enforces M7 rather than relitigating it.

## Product forks (proposed defaults — confirm before implement)

1. **When does the currency freeze?** Proposed: on the **first transaction**.
   Accounts alone don't lock it — switching with accounts-but-no-transactions
   relabels the opening balances after an explicit confirm ("Relabels N
   accounts to EUR — amounts unchanged"). Rationale: "create accounts → notice
   wrong currency → switch" is the realistic first-run flow; locking on first
   *account* would trap defaults-SGD users instantly. Stricter alternative:
   freeze on any data.
2. **Mixed ledger found (pre-fix damage): warn or block?** Proposed: **warn +
   guided relabel**, not the review's harder "block all reporting". A
   dismissible banner overstates nothing if copy is honest, and blocking the
   whole dashboard for what is likely a one-user-in-a-hundred state punishes
   disproportionately. The resolve flow relabels **all** rows to one chosen
   currency with explicit "amounts are not converted" copy.

## Scope

**IN:**
1. **Freeze rule** — `canChangeCurrency` domain helper: `false` once any
   transaction exists. Settings currency row renders disabled with helper text
   ("Currency is fixed once transactions exist") when frozen; with
   accounts-only, changing prompts the relabel confirm, then updates the
   setting **and** every account row's `currency` in one pass.
2. **Write-path consistency** — every new transaction/recurring template
   already stamps the global currency at creation; after freeze this is
   consistent by construction. No change beyond the freeze itself.
3. **Mixed-ledger detection** — `SELECT DISTINCT currency` over accounts,
   transactions, recurring templates (cheap SQL, not a full-table JS load),
   compared with the setting; runs once per launch after DB init. Pure
   decision helper `resolveLedgerCurrencyState(...)` in domain.
4. **Resolve flow** — if mixed: banner on Dashboard + a row in Settings →
   sheet: pick the ledger currency (offer the distinct values found, current
   setting first) → relabel all rows (accounts, transactions, recurring
   templates) + set the setting → `bumpDataRevision()` (backup catches the
   repair). Copy states plainly: labels change, numbers don't.
5. **Zero-decimal input guard** — `currencyExponent(code)` in
   `src/domain/money.ts` backed by a small `ZERO_DECIMAL_CURRENCIES` set (JPY,
   KRW, VND, CLP — the four shipped zero-exponent codes). `AmountKeypad` /
   `AmountField` hide/ignore the decimal key when the ledger exponent is 0.
   Stored scale stays ×100 for every currency — display via `Intl` is already
   exponent-correct, so no migration and no dual-scale risk.
6. **Widget formatter** — app writes `exponent` into the widget summary JSON
   (`src/features/widget/summary.ts`); `formatMinorUnits` in
   `WidgetSummary.swift` uses `maximumFractionDigits = exponent` (still ÷100).
   Missing field defaults to 2 (old JSON stays renderable — same defensive
   decoding the widget already practises).

**OUT:**
- Multi-currency ledgers, FX conversion, historical revaluation.
- Exponent-native storage (minor units = ISO exponent) — a real migration;
  only worth doing with the versioned-migration machinery (review F9).
- Locale-aware formatting beyond currency (dd-MM-yyyy, en-US month labels,
  Monday weeks — review F15, separate).
- Trimming `SUPPORTED_CURRENCIES` — with input guarded and display consistent,
  all 46 remain safe to offer.

## Approach (concrete)

### Freeze (`app/(tabs)/settings.tsx` + settings repository)
`onPickCurrency` branches on `canChangeCurrency({ hasTransactions })`:
frozen → row disabled (no sheet); accounts-only → confirm dialog → single
relabel routine `relabelLedgerCurrency(code)` in a new
`src/features/settings/currencyIntegrity.ts` that updates setting + account
rows (+ transactions and recurring templates in the mixed-repair case — same
routine, wider row set) and bumps the data revision.

### Detection (`app/_layout.tsx` after DB init)
```ts
const state = await detectLedgerCurrencyState();  // { ok } | { mixed: string[] }
```
Store dismissal in a settings key (`currency_banner_ack`) so the banner is
per-incident (re-arms if a new mismatch appears), not per-launch nagging.

### Keypad
`AmountKeypad` receives `allowDecimal` (from ledger exponent); typing "12" in a
JPY ledger stores 1200 minor units and displays "¥1,200" everywhere — app
(`Intl`) and widget (exponent field) agree.

## Acceptance criteria
1. **Node suite green**; new BDD scenarios:
   - `canChangeCurrency` truth table (empty / accounts-only / has transactions)
   - `resolveLedgerCurrencyState`: clean, stale-label, mixed cases
   - `currencyExponent` for the four zero-decimal codes + default 2
   - relabel routine output relabels every row kind, converts no amounts
2. **Sim/device confirm** —
   - fresh install: switch SGD→JPY freely; add one transaction; currency row
     is now disabled with helper text
   - accounts-only: switching shows the relabel confirm and updates account
     currencies
   - seeded mixed ledger (SGD rows + JPY setting): banner appears; resolve →
     pick SGD → totals correct, banner gone, backup fires on next backgrounding
   - JPY ledger: keypad has no decimal key; widget shows "JPY 1,200" not
     "JPY 1,200.00"
3. **No regression** — a normal single-currency ledger sees no banner, no new
   prompts, identical totals.

## Edge cases
- **Restore of a mixed backup** — detection runs post-restore (restore path
  ends with the same launch-style init), so a repaired-then-restored-old
  ledger re-arms the banner. Correct: the restored data really is mixed.
- **Recurring templates** — must relabel with everything else, or the next
  posting reintroduces a stray currency.
- **`DEFAULT_CURRENCY = 'SGD'` first-run** — the welcome flow doesn't create
  data (review F16), so the user always has a pre-freeze window; the store
  listing's SGD default remains as shipped.
- **Widget JSON forward-compat** — old widget binary + new JSON: unknown
  `exponent` key is ignored by `Codable` decoding → old two-decimal rendering
  until the widget updates; acceptable during rollout.

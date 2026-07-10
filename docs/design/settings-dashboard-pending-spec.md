# Build spec — remove upgrade, dashboard category donuts, pending transactions

Worktree: `.claude/worktrees/fm-spike` (branch `claude/account-creation-spike`).
Three independent features bundled for one build. Domain logic must stay
framework-free (plain-Node BDD suite). Ground truth: SQLite/Drizzle is the
source of truth; treat AI/OCR output as untrusted; parameterised SQL only.

---

## Feature 1 — Remove the "Upgrade" option from Settings

### Objective
Delete the premium/upgrade entry point in Settings. It's a placeholder stub
(a native `Alert` reading "Subscriptions via RevenueCat (Phase 4)") and the app
is now fully local with no purchases — it should not advertise a paywall.

### Approach
Single file: `app/(tabs)/settings.tsx`.
- Delete the entire Premium section, currently lines ~313-318:
  ```tsx
  <SectionLabel>ProjectXavier Premium</SectionLabel>
  <Row icon="star" label="Upgrade — unlimited AI, receipt scan, sync"
       onPress={() => Alert.alert('Premium', 'Subscriptions via RevenueCat (Phase 4)')} />
  ```
- Remove the now-unused `Alert` import (line ~5) **only if** `Alert` is used
  nowhere else in the file (it is currently used only here — verify before
  removing so lint stays green).
- Update the file header comment (line ~2) if it mentions "subscription entry
  points" so the comment no longer describes deleted code.

### Acceptance criteria
- [ ] Settings screen renders no Premium/Upgrade section or row.
- [ ] No dangling `Alert` import; `npm run lint` clean.
- [ ] No other screen references the removed row.

### Out of scope
- Do **not** touch `supabase/functions/_shared/guard.ts` (a server-side quota
  comment — unrelated, not wired to the app).
- Do **not** touch iOS entitlements (`app.config.ts`, widget config) — those
  are App-Group/CloudKit, not purchases.

---

## Feature 2 — Dashboard category-breakdown donut charts

### Objective
Add two donut charts to the Dashboard showing how the selected period's money
breaks down **by category**: one for expenses, one for income. The existing
tiles/sparklines already show the *totals* and per-bucket flow; these donuts add
the missing "where did it go / come from" composition view.

### Approach
Chosen shape (confirmed with user): **category-breakdown donuts**, not extra
trend lines. All charts in this app are hand-rolled `react-native-svg` (no
victory/recharts) — follow that pattern.

**New pure domain function** — `src/domain/period.ts`:
```ts
export interface CategorySlice {
  categoryId: string | null;   // null = uncategorised
  amount: number;              // minor units, positive
}
export function categoryBreakdown(
  transactions: Transaction[],
  range: PeriodRange,
  type: 'expense' | 'income',
): CategorySlice[]
```
- Sum `amount` by `categoryId` for txns where `tx.type === type` and
  `inRange(tx, range)`. Exclude transfers implicitly (type filter) and **exclude
  pending** (Feature 3 — see below; if Feature 3's shared exclusion helper
  exists, use it).
- Return slices sorted by `amount` descending. Uncategorised txns collapse into
  a single `categoryId: null` slice.
- Pure/framework-free — must be unit-testable in the plain-Node suite.

**New chart component** — `src/components/ui/DonutChart.tsx`:
- Props mirror the existing chart components' conventions (see `BarChart.tsx`,
  `Sparkline.tsx`): `{ slices: Array<{ value: number; color: string }>; size?: number; strokeWidth?: number }`.
- Render an SVG ring of arc segments proportional to each slice (a `Circle`
  with `strokeDasharray`/`strokeDashoffset` per segment, or `Path` arcs).
- Return `null` (render nothing) when there are no slices / total is 0.
- Any gradient/def ids must be unique per instance (same rule as
  `Sparkline.tsx` line ~24: document-global ids collide) — but a flat-color ring
  needs no gradient, which is simpler; prefer flat category colors.

**Category display resolution** (labels + colors for the legend):
- Categories carry a `kind` and a display color/emoji — read the `categories`
  table (`src/db/schema.ts`) to confirm the exact color/emoji fields, and load
  them the way the dashboard/transaction rows already resolve category display
  (check how `TransactionFormSheet`/transaction rows render category
  emoji/color and reuse that source rather than inventing a second lookup).
- Map each `CategorySlice.categoryId` → `{ name, color }`. Uncategorised →
  label "Uncategorised", a neutral theme color (`c.muted`).

**Dashboard wiring** — `app/(tabs)/dashboard.tsx`:
- Compute slices from the already-scoped, period-filtered data the screen uses:
  `categoryBreakdown(selectedTxns, range, 'expense')` and `('income')`
  (`selectedTxns` lines ~100-103, `range` line ~88).
- Add a new card below the existing stat tiles (~after line 332) rendering the
  two donuts, each with a legend (category color swatch + name +
  `formatMoney(amount, currency)`, using the existing `formatMoney` from
  `src/domain/money.ts` and `useThemeColors()`).
- If a period has no expenses (or no income), that donut shows a compact empty
  state ("No expenses this period") instead of an empty ring.
- Consider capping the legend to top N (e.g. 6) slices with the remainder summed
  into an "Other" slice, to keep the legend readable — implementer's call, but
  if capped, the ring must still represent 100% (Other included).

### Acceptance criteria
- [ ] Dashboard shows an expense donut and an income donut for the selected
      period, each with a legend of category → amount.
- [ ] Slices are proportional and sum to the period total for that type.
- [ ] Changing the period (PeriodSheet) or account filter updates both donuts.
- [ ] Uncategorised transactions appear as a single labelled slice.
- [ ] Empty period/type renders an empty state, not a broken/zero ring.
- [ ] `categoryBreakdown` has unit tests (proportions, sorting, uncategorised
      bucket, pending excluded, transfers excluded).

### Out of scope
- No new charting dependency. No changes to the existing MultiLineChart /
  BarChart / Sparkline behavior beyond adding the new component.
- No drill-down/tap-into-category navigation (display only).

---

## Feature 3 — Pending transactions (excluded from all money math)

### Objective
Add a `pending` boolean to transactions (default `false`), toggleable in the
add/edit form. A pending transaction stays visible in lists (clearly marked) but
is **excluded from every aggregation** — period income/expense totals, charts,
transaction counts, account balances, net worth, and the widget summary — until
it is un-pended, at which point it re-enters all totals automatically.

Note: user described this as a "radio button." Interpreted as a labelled on/off
toggle (a `Switch`), matching the app's established boolean control (the
biometric toggle in `settings.tsx` ~lines 278-284). Default off (not pending).

### Approach — persistence & types
1. **Schema** `src/db/schema.ts`: add to the `transactions` table
   `pending: integer('pending', { mode: 'boolean' }).notNull().default(false)`
   (mirrors `accounts.archived` / `recurringSeries.paused`).
2. **Migration** `src/db/migrate.ts`: add the column to the `CREATE TABLE`
   transactions DDL in `TABLES`, **and** add an `ADD_COLUMNS` entry for existing
   DBs: `{ table: 'transactions', column: 'pending', type: 'INTEGER NOT NULL DEFAULT 0' }`
   (this is the established additive-migration pattern; existing rows default to
   0 = not pending).
3. **Domain type** `src/domain/types.ts`: add `pending: boolean;` to
   `interface Transaction` (required — let TS surface every construction site).
4. **Validation** `src/lib/validation.ts`: add `pending: z.boolean().default(false)`
   to `transactionSchema` (tolerates older payloads, always yields a boolean).
   Do **not** add `pending` to `aiParsedExpenseSchema` — the AI never sets it;
   AI drafts default to not-pending at construction.
5. **Repository** `src/features/transactions/repository.ts`:
   - `createTransaction` / `updateTransaction`: include `pending` in the
     insert/update value maps.
   - `rowToTransaction`: map `pending: row.pending ?? false`.
6. **Other insert/restore paths** (must carry `pending` so state round-trips —
   architecture guardrail: backup/restore must round-trip):
   - `src/features/backup/repository.ts` `applyBackup` — include `pending` when
     re-inserting restored transactions.
   - `src/features/recurring/repository.ts` `postDueOccurrences` — posted
     occurrences set `pending: false`.
   - `src/db/sql.ts` `buildInsertTransaction` — add the `pending` column to the
     parameterised column/value list **if** the input-safety BDD suite asserts
     the full column set; keep it parameterised (never concatenate).

### Approach — exclusion from aggregations (highest risk; must be complete)
Introduce a single source of truth for "counts toward money math" and apply it
everywhere. Suggested helper in `src/domain/types.ts` or `period.ts`:
`export const isCounted = (tx: Transaction) => !tx.pending;`

Apply the exclusion at these sites (the complete list — verify each):
- `src/domain/period.ts`: `totalsForRange`, `groupByPeriod`, `cashFlowSeries`
  (and therefore `activePeriods`) — skip `tx.pending`.
- `src/domain/balances.ts`: make `signedDelta` return `0` for a pending tx (this
  single change covers `accountBalance`, `accountBalances`, `netWorth`, the
  `*AsOf` variants, `accountPeriodBalances`, and `balanceSeries`).
- `src/components/ui/PeriodSheet.tsx`: the per-period transaction **count** map
  (~lines 219-223) must skip pending.
- `src/features/widget/summary.ts`: uses `totalsForRange`, so covered once
  `period.ts` excludes pending — confirm it computes nothing else money-related
  that would need the filter.
- Feature 2's `categoryBreakdown` — exclude pending (uses `isCounted`).

Do **not** exclude pending from the transaction **lists** — they must still
render (marked). Confirm `listTransactions`, the transactions screen, account
detail list, and the period detail list still show pending rows.

### Approach — UI
- `src/components/transactions/TransactionFormSheet.tsx`: add `pending: boolean`
  to `FormValues`; render a labelled toggle row ("Pending") using the `Switch`
  pattern from `settings.tsx` (~278-284), defaulting to `initial.pending ?? false`.
  Thread `pending` through the three host screens' `onSave` builders that
  construct a `Transaction`: `app/(tabs)/transactions.tsx`,
  `app/account/[id].tsx`, and the assistant confirm flow in `app/(tabs)/index.tsx`
  (AI drafts default `pending: false`).
- Mark pending rows in the lists: a small "Pending" pill/badge and/or dimmed
  amount, in the transactions list and account-detail rows. Match existing
  row/badge styling; keep it lightweight.

### Acceptance criteria
- [ ] New transactions default to not-pending; the form toggle persists.
- [ ] A pending transaction is excluded from: period income/expense/net totals,
      sparklines & cash-flow bars, category donuts, per-period transaction
      counts (PeriodSheet), account balances, net worth, and the widget summary.
- [ ] A pending transaction still appears in the transactions list and account
      detail, visually marked as pending.
- [ ] Toggling a transaction from pending → not-pending makes it re-enter every
      total/count/balance (and vice-versa), with no other edit required.
- [ ] Fresh install (CREATE TABLE) and upgrade-in-place (ADD_COLUMN on an
      existing DB) both yield a working `pending` column defaulting to 0.
- [ ] Backup → restore round-trips the `pending` value.
- [ ] Domain unit tests cover pending exclusion in `period.ts` and `balances.ts`
      (a pending tx contributes 0 to totals, counts, and balances).
- [ ] `transactionSchema` accepts payloads with and without `pending`.

### Out of scope
- No "auto-clear on date" or scheduled un-pending — pending is a manual flag.
- No filtering UI to show/hide pending in lists (always shown, marked).
- Recurring series themselves gain no pending concept; only posted occurrences
  carry the column (default false).

---

## Cross-cutting constraints & conventions
- Keep domain modules (`src/domain/*`) framework-free — no React/Expo imports —
  so the plain-Node BDD suite keeps covering them.
- Parameterised SQL only (guardrail #4); the new column must not break the
  `src/db/sql.ts` input-safety suite.
- Money is integer minor units; direction derives from `tx.type`, never the sign
  of `amount`.
- Match existing theme usage (`useThemeColors()`, `c.positive`/`c.negative`/
  `c.muted`) and `formatMoney`.
- Verify before done: `npm run typecheck`, `npm run lint`, `npm test` all green.

## Edge cases & risks
- **Incomplete exclusion** is the main risk — a missed aggregation site would
  let a pending tx leak into some total. The `signedDelta`-level change and the
  `isCounted` helper minimise scatter; QA must check every site in the list.
- Making `Transaction.pending` required will surface every place a transaction
  is constructed (form builders, recurring posting, backup restore, AI draft,
  **test fixtures**) — update them all; this is intended coverage, not scope
  creep.
- Category donut with a single dominant category or many tiny ones — ensure the
  ring and legend still read (top-N + "Other" if capped).
- Donut color collisions if two categories share a color — acceptable; use the
  category's own color, fall back to a palette index if unset.
- Widget summary writes are already atomic (temp+rename); no change needed
  beyond the pending exclusion flowing through `totalsForRange`.

## Suggested handoff
> Use the implementer agent to build the spec above (all three features), in the
> `.claude/worktrees/fm-spike` worktree. Then run qa-tester on the resulting
> diff (focus: complete pending-exclusion across every aggregation site, and
> fresh-install vs upgrade-in-place migration), then reviewer.

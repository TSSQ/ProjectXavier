# Build spec — FM-proposed pending (guarded) + donuts into the chart carousel

Worktree: `.claude/worktrees/fm-spike` (branch `claude/account-creation-spike`).
Two independent features. Domain logic stays framework-free (plain-Node BDD).
Builds on build 25 (pending transactions + category donuts already shipped).

---

## Feature 1 — FM proposes `pending`, a deterministic guard disposes

### Objective
Let the on-device parse pre-set the transaction form's **Pending** toggle from
natural language, so "pending $40 dinner" arrives with Pending already on — while
never silently mis-flagging a normal transaction.

### Probe findings that shape this (already run; see below — do NOT re-derive)
On the Mac FM probe (5 runs × 14 utterances, schema + instructions mirroring
`deviceParsePrompt.ts`):
- **Explicit markers → 5/5 reliable**: "pending", "provisional", "tentative",
  "unconfirmed" each flagged `pending=true` every run.
- **Plain transactions → 0/5 false**: "paid 30 gas", "coffee 5", "salary 3000",
  "40 dinner", "bought groceries 80" all stayed false.
- **Implicit phrasing → flaky**: "I might have spent 20" 4/5, "not sure yet" 3/5.
- **False-positive traps** (the reason we guard): "pending **tray** return, 4 cai
  fan" → **5/5 wrongly true** (keyword not about the transaction); "might go back
  later, paid 25 lunch" → 3/5 wrongly true.
- **No regression**: amount extraction stayed 70/70 with the field added.

Conclusion (house rule): the 3B model is a keyword detector, not a judge. Take
its reliable signal (explicit markers) and let a deterministic guard remove the
context-blind false positives.

### Approach — the FM field (all three mirror spots, VERBATIM)
`src/domain/deviceParsePrompt.ts`:
1. Add to `deviceParseSchema` a `pending` boolean with EXACTLY this `.describe`
   (this wording passed the probe — copy verbatim, do not reword):
   > `true ONLY when the user marks this expense as pending, provisional,
   > unconfirmed, tentative, or not yet finalized (words like "pending",
   > "provisional", "tentative", "might have", "not sure yet", "unconfirmed").
   > false for a normal, completed, already-paid transaction. Default to false.`
   Note the binding rejects `.nullable()`; a required boolean defaulting to false
   is correct (the model always returns one).
2. Add the matching instruction line to `buildDeviceParseInstructions()`:
   > `Set "pending" to true ONLY when the user marks the expense as pending,
   > provisional, unconfirmed, tentative, or not yet finalized; false for a
   > normal completed transaction. Default to false.`
3. Extend `NormalizedDeviceParse` with `pending: boolean` and set it in
   `normalizeDeviceParseOutput` via a `toBool(raw.pending)` helper (truthy/"true"
   → true, else false).

### Approach — the deterministic guard (the load-bearing part)
Add to `deviceParsePrompt.ts` a pure, exported, plain-Node-testable guard and
apply it inside `applyGroundingGuards` (the existing post-parse guard seam, right
where `account`/`payee` are already guarded):

```ts
/** Explicit pending markers, in a transaction-status position. The FM reliably
 *  flags these but also fires on context-blind traps ("pending tray return") —
 *  keep pending only when a marker sits ADJACENT to a number that IS the actual
 *  parsed amount (not merely any nearby number), which every probe true-case
 *  satisfies and the traps do not. Shipped signature takes the amount to anchor
 *  on: textAssertsPending(text, amount). */
export function textAssertsPending(text: string, amount: number | null): boolean { ... }
```
- Marker set: `pending | provisional | tentative | unconfirmed | unpaid |
  not yet (paid|confirmed|final(ised|ized)?)`.
- Position rule: a marker immediately adjacent to the amount token — i.e. marker
  followed by optional `$` then digits (`pending $40`, `provisional 15`,
  `tentative 50`, `unconfirmed 12.50`), OR digits then marker within a couple of
  words (`40 dinner, pending`). This is what separates all 5 explicit true-cases
  from `pending tray return, 4 …` (marker precedes a noun, amount is past a
  comma).
- In `applyGroundingGuards`: `pending: parsed.pending && textAssertsPending(text)`.
  So the FM's `true` survives only when the text asserts it; hallucinated/trap
  positives drop to false; a plain transaction stays false.

**Deliberate trade:** implicit phrasing with no explicit marker ("I might have
spent 20") will NOT be auto-flagged (the guard requires a marker). That is the
correct precision-over-recall choice for silently changing whether a transaction
counts — the manual Pending toggle (build 25) remains the override. State this in
the spec's out-of-scope.

### Approach — wire into the draft/confirm flow
The FM parse produces a draft the user confirms in `TransactionFormSheet`, which
already has the Pending switch and `TransactionDraft.pending` (added build 25).
- `src/features/ai/deviceParse.ts` (and/or `src/domain/assistant.ts`
  `buildTransaction`/draft mapping): carry the normalized+guarded `pending` into
  the draft so the confirm sheet opens with Pending pre-set. User can still flip
  it before saving.
- `src/lib/validation.ts` `aiParsedExpenseSchema`: add `pending:
  z.boolean().optional()` (or `.default(false)`) so the normalized parse
  re-validates at the trust boundary (guardrail #6) with the new field.

### Acceptance criteria
- [ ] `deviceParseSchema`, instructions, and `NormalizedDeviceParse`/normalizer
      all carry `pending`; the three prompt spots match VERBATIM.
- [ ] `textAssertsPending` + `applyGroundingGuards` guard: unit tests encode the
      **14-case probe suite** as expectations — every explicit-marker case →
      guarded pending true; every plain case AND every trap ("pending tray
      return", "might go back later") → false. False positives = 0.
- [ ] An FM parse of "pending $40 dinner" opens the confirm sheet with Pending
      ON; "40 dinner" opens it OFF.
- [ ] `aiParsedExpenseSchema` accepts the parse with/without `pending`.
- [ ] Amount/type/payee extraction unaffected (existing parse tests still green).

### Out of scope
- No auto-detection of implicit/marker-less uncertainty ("might have spent") —
  precision trade above; manual toggle covers it.
- Not changing the manual toggle, the exclusion logic, or any aggregation (build
  25 already handles those).

---

## Feature 2 — Move the category donuts into the chart carousel

### Objective
Relocate the two category-breakdown donuts from their standalone card into the
existing swipeable chart carousel, so all four charts live in one swipe deck.

### Approach
All inline in `app/(tabs)/dashboard.tsx` (no shared carousel component):
- The carousel is a `ScrollView horizontal pagingEnabled` with 2 inline slides
  (page 0 = account-balance `MultiLineChart`, page 1 = cash-flow `BarChart`),
  slide width `slideWidth = screenWidth - 48`, active page in `chartPage` state
  (set from `onMomentumScrollEnd`).
- **Add two slides** after the existing two, in this order: **[0] Account
  balances · [1] Cash flow · [2] Expenses by category · [3] Income by category.**
  Each new slide is a `<View style={{ width: slideWidth, paddingHorizontal: 16,
  paddingTop: 8, paddingBottom: 4 }}>` (matching lines 310/329) wrapping one
  `CategoryDonutRow` (expense legend, then income legend) with its empty-state.
- **Remove the standalone donut card** (the `By category · {sel.label}` block,
  ~lines 404-421) — its two `CategoryDonutRow`s move into the slides. Keep the
  `expenseSlices/incomeSlices/expenseLegend/incomeLegend` memos as-is.
- **Header title** (currently `chartPage === 0 ? 'Account balances' : 'Cash
  flow'`): generalize to a 4-entry lookup by `chartPage` (`['Account balances',
  'Cash flow', 'Expenses by category', 'Income by category']`). The `netEnd`
  net-worth figure in the header: keep it only for the two financial pages, or
  show `sel.label` on the donut pages — implementer's call, but the header must
  read correctly on all four pages (no stale "Cash flow" on a donut page).
- **Page dots**: change the hardcoded `[0, 1].map(...)` to cover 4 pages (derive
  from a page count, e.g. `Array.from({length: PAGES})`), so the active-dot logic
  `i === chartPage` still works.

### Acceptance criteria
- [ ] The carousel has 4 swipeable pages in the order above; the standalone donut
      card is gone (donuts appear only in the carousel).
- [ ] Page dots show 4; the active dot tracks the swiped page.
- [ ] The card header title is correct on every page (no two-page assumption
      left).
- [ ] Donut slides size to `slideWidth` and visually match the chart slides
      (same card chrome/padding).
- [ ] Period/account-filter changes still update the donuts.
- [ ] Empty period renders each donut slide's empty-state, not a broken ring.

### Out of scope
- No change to `DonutChart`, `categoryBreakdown`, or `buildLegend` behavior.
- No new carousel library; keep the `ScrollView pagingEnabled` approach.

---

## Cross-cutting constraints
- Domain modules stay framework-free; the pending guard is pure and lives in
  `deviceParsePrompt.ts`, tested in the plain-Node suite.
- Treat FM output as untrusted — re-validate via `aiParsedExpenseSchema`.
- Any change to the three prompt-mirror spots must be copied VERBATIM (a reworded
  guide invalidates the probe result).
- Verify green before done: `npm run typecheck && npm run lint && npm test`.

## Edge cases & risks
- **Guard too loose** → a trap re-flags (regression the probe-suite test guards).
- **Guard too tight** → an explicit "pending" case stops flagging (the 5 explicit
  cases are the test floor).
- Carousel header/dots still assuming 2 pages is the most likely miss — the
  acceptance list calls both out.
- The manual toggle and FM pre-set must not fight: FM sets the draft's initial
  pending; the user's explicit toggle in the sheet always wins on save.

## Probe artifacts (for the record)
Harness recreated at scratchpad `fm-probe/probe.swift` (mirrors the contract +
`pending`); raw results in `fm-probe/probe-out.txt`. Recall 27/30, specificity
32/40 (8 FP, all on traps/implicit), amount 70/70.

## Suggested handoff
> Use the implementer agent to build both features above in the fm-spike
> worktree. Then qa-tester on the diff (focus: the pending guard against the full
> 14-case probe suite, and the 4-page carousel header/dots), then reviewer.

# Monthly category budgets — spec

- **Status:** draft for approval
- **Approved design:** https://claude.ai/artifact/Ue9kc84BbFs8YRodcYoUGS (Version 2, option **A — budget card first**). The user asked for the mockup to be built exactly. Where this spec and the mockup disagree, the mockup wins on visuals and this spec wins on behaviour.
- **Ship run:** `docs/ship-runs/monthly-budgets.md`

## 1. Objective

The user sets a monthly budget per expense category. Expenses they already log count against their category's budget, with nothing new to record. The dashboard shows what's left and whether they're on pace. "Can I afford X?" is answered from the budget instead of being refused.

## 2. Scope

In scope:
1. Budget storage: a monthly amount per top-level expense category. A change applies to "this month only" or "this month onward" (the default). Budgets carry forward until changed.
2. A pure domain module for the budget math (spent, scheduled, left, pace, states, suggestions), BDD-tested.
3. Dashboard budget card (mockup §1, option A).
4. Budget screen, edit sheet, first-run suggestions and category detail (mockup §3).
5. Assistant: the afford answer, the ambiguous-category chips, "set X budget to N", and the "left this month" chip on saved expenses (mockup §2 and §4).

Out of scope:
- An Assistant chat feed or history. The cards render in today's single-exchange layout. History gets its own `/design` round.
- Income budgets, rollover of unspent amounts, alerts and notifications, widget changes, and per-account budgets.
- A per-budget "paid up front" switch. Scheduled bills are deducted up front instead (§4.2).

## 3. Data model

New table, added to `src/db/schema.ts` and the base-table list in `src/db/migrationPlan.ts` (`CREATE TABLE IF NOT EXISTS`, idempotent):

```
budgets(
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL,      -- a top-level expense category
  amount       INTEGER,            -- minor units; NULL = "no budget" from start_month
  start_month  TEXT NOT NULL,      -- 'YYYY-MM' (local calendar month)
  end_month    TEXT,               -- 'YYYY-MM' inclusive; NULL = open-ended
  created_at   INTEGER NOT NULL
)
CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id, start_month);
```

**Resolution** (pure function `budgetFor(rows, categoryId, month)`): among rows for the category where `start_month ≤ month ≤ (end_month ?? ∞)`, the row with the latest `start_month` wins. Ties go to the latest `created_at`. A winning row with `amount = NULL` means no budget.

**Writes** (repository `src/features/budgets/repository.ts`; parameterised SQL only, values validated with zod at the boundary):
- **Month only** (M): insert `start=end=M`.
- **M onward**: delete this category's rows with `start_month ≥ M`, then insert `start=M, end=NULL`. Later one-off settings are replaced on purpose.
- **Remove budget**: the same two modes with `amount = NULL`.
- **Category deleted**: its budget rows are deleted in the same cascade (`src/domain/accountDeleteCascade.ts` sibling for categories, or the category delete path).

**Backup.** M3 backups are a whole-DB SQLite image (ADR 0006), so the table is included automatically. Add a round-trip test: back up, restore, and get the same budgets. Legacy `.json` restores simply have no budgets.

## 4. Budget math — `src/domain/budgets.ts`

Framework-free. Takes plain data (`Transaction[]`, `RecurringSeries[]`, `Category[]`, budget rows, `now`, `month`) and returns view models. All amounts are integer minor units.

### 4.1 Which expenses count
- `type === 'expense'` only. Income and transfers never count.
- A refund (an income transaction or negative amount in an expense category, as the app represents refunds today) reduces that category's spend. Follow how `categoryBreakdown` in `src/domain/period.ts` already treats them.
- Subcategories roll up into their top-level ancestor (`parentId` chain). Budgets exist only for top-level expense categories.
- A category's spent is floored at 0: refunds can cancel spending but never make "left" exceed the budget (decided at QA, 2026-10-03).
- Every account counts, archived ones included. **The account filter is ignored.**
- Month = local calendar month (`localDayNoon` semantics from `src/domain/dates.ts`).

### 4.2 Spent, scheduled, left
For category C in month M:
- **spent** = the sum of C's expenses in M where `isCounted(tx, now)`.
- **scheduled** = the sum of:
  - expenses in M that are not counted yet: future-dated (`isUpcoming`) or `pending`;
  - occurrences of active (not paused, not archived) recurring series whose template is an expense in C, from `upcomingOccurrences(series, from, limit, until=endOf(M))`, minus skipped dates, and minus any occurrence already posted as a transaction (match on `seriesId` + `occurrenceDate`), so nothing counts twice.
- **left** = budget − spent − scheduled. It can be negative ("$X over").
- **committed** = spent + scheduled.

For a past month, scheduled holds only rows still future-dated or pending. For a future month, spent is 0.

### 4.3 Pace (current month only)
Let `d` = today's day-of-month, `N` = days in M, and `f = d / N`.
- **fixed** = the sum of C's in-month amounts that come from a recurring series or are future-dated: posted series transactions in M, plus everything in **scheduled**. These are bills, and they count from day 1.
- **target** = fixed + (budget − fixed) × f. On the bar, the **Today** tick sits at target ÷ budget.
- **Overall chip** (totals over budgeted categories):
  - committed ≤ target: **On pace** (green `chip ok`)
  - committed ≤ target + 10% of budget: **A little ahead of pace** (gold `chip warn`)
  - committed ≤ budget: **Ahead of pace** (gold)
  - committed > budget: **Over budget** (red)
- **Category state:**
  - **over** when committed > budget: red fill, "$X over".
  - **warn** when committed > target + 5% of budget, or the **flexible** part is ≥ 85% used: (committed − fixed) ≥ 85% of (budget − fixed). Use this only when budget − fixed > 0; otherwise skip the 85% test. Gold fill and "$X left" in gold. Bills are expected in full, so a budget made of bills never warns just for being mostly committed. Only going over, or flexible spending, can trip it.
  - **ok** otherwise: primary fill and "$X left" in muted text.
- **Days left** = N − d. **Per day** = left ÷ (N − d), shown as "about $51/day". On the last day show "Last day" instead. When left ≤ 0, hide per-day.
- Past and future months show no tick, chip or per-day figure.

These thresholds reproduce every state in the mockup: Dining is warn; Shopping, Groceries, Transport, Health and Bills are ok; Entertainment is over; and the overall chip reads "A little ahead". Pin them in tests with the mockup's numbers.

*Amended 2026-10-03 (implementer catch): the first draft applied the 85% rule to all of committed. That made Bills (92% committed, all bills) warn, which contradicted the approved mockup.*

### 4.4 Sorting and grouping
- **Attention order:** over (largest overage first), then warn, then ok. Within warn and within ok, sort by **pace ratio** = committed ÷ target, highest first: how far along the category is relative to where it should be today. For a past or future month (no pace), use committed ÷ budget. Mockup fixture order: Entertainment, Dining, Shopping (1.03), Groceries (1.02), Bills (0.95), Transport (0.83), Health (0.34).
- **Dashboard:** the first 3 in attention order, then "+ N more on track" (or "+ N more" when the rest aren't all ok).
- **Not budgeted:** top-level expense categories with spent + scheduled > 0 in M and no budget, sorted by amount descending.

### 4.5 Suggestions (first run and edit-sheet hint)
- **3-month average** = the sum of counted spend in the 3 full calendar months before M, divided by 3, rounded to the nearest $10 (1000 minor units, half up).
- First-run lists every top-level expense category with an average > 0. Categories with an average of $50 or more start ticked; the rest start unticked.
- With no spend in those 3 months, first-run shows only "Set them myself".

### 4.6 Afford (`affordAnswer(amount, categoryId | 'all', …)`)
Current month only. Returns `{ verdict: 'fits' | 'over', leftNow, after, overallLeftAfter }`:
- `after` = leftNow − amount.
- `fits` when after ≥ 0.
- When the verdict is `over`, also return overall left − amount, for the line "All budgets together would still have $N left". Show that line only when this value is > 0.

## 5. UI — build exactly as the mockup

Tokens, radii and components come from the existing system: `Card`, `Button`, `Chip`, `KeypadSheet`, `SegmentedControl`, `ScreenHeader` and `XavierPet`. Category icons are the category's own emoji (`c.icon ?? '🏷️'`).

The **budget bar** is one new component, `src/components/ui/BudgetBar.tsx`:
- a `wellRecessed` track;
- a solid fill (primary / gold / negative by state);
- a **hatched scheduled** segment in muted;
- an optional **ghost** segment (hatched primary or negative) for the afford purchase;
- an optional **Today** tick in `text`;
- thick (8pt) and thin (5pt) variants.

Hatching is drawn with `react-native-svg`, which is already used by the charts. State is always given in words as well as colour.

### 5.1 Dashboard card — `app/(tabs)/dashboard.tsx`
- Placed directly under `AccountFilterPills` / `IncludeArchivedToggle`, above the chart card.
- Shown only when the selected period is a **single month** (as the budget card, the setup card or the empty card below). Hidden for a year and for a custom date range.
- Contents follow the mockup:
  - the "BUDGET · OCTOBER" label and "All budgets ›" (which pushes `/budget`);
  - "$663 left of $2,100" (`formatMoney`);
  - the thick bar with a Today tick and its "Today" label;
  - the legend "Spent $X · Scheduled $Y" (the scheduled part only when > 0);
  - the pace chip with days left and per-day;
  - a divider, the worst 3 categories with thin bars, and "+ N more on track".
- Card style: `surface`, `borderAccent`, `radius.lg`.
- When an account filter is active, the card adds the muted caption "All accounts".
- **No budgets set** and the period is the current month: a compact card reading "Set a monthly budget per category" with a "Set up budgets" button that pushes `/budget`. For any other single month with no budgets (past or future): a compact card with the same surface, border and title row, reading "No budgets in {Month}" (with the year when it is not the current year) over the muted line "Tap to add budgets for {Month}", with a "Budget ›" affordance. The whole card is a button that pushes `/budget` for that month (a11y label "No budgets in {Month}. Open budget"). Year and custom-range periods still render nothing.
- **Past or future month:** the same card without the tick, chip or per-day figure.

### 5.2 Budget screen — `app/budget.tsx` (pushed route, like `app/recurring.tsx`)
- Header: back chevron, "Budget", and the Dashboard's glass period pill ("October 2026") that opens a month-only period sheet. The sheet lists every month with activity or a stored budget, plus the current, next and selected months, and marks the selected one. It opens on the dashboard's month, or the current month when opened from Settings.
- **Left to spend** summary card: thick bar, legend and "13 days left".
- "CATEGORIES" with "+ Add". Add opens a picker of top-level expense categories without a budget, then the edit sheet.
- Rows show icon, name, "$X left" or "$X over" (coloured by state), a thin bar with tick, and "$412 of $600". When the category has scheduled amounts, the row shows "$172 paid · $150 scheduled · of $350" instead.
- "NOT BUDGETED" rows show "$45 spent this month" and a "Set budget" link that opens the edit sheet.
- Tapping a budgeted row opens category detail.
- **First run** (no budget rows at all): Xavier's avatar with "Want to start from what you usually spend? These are your 3-month averages.", a checklist of the suggestions with a monthly total, "Use these budgets" (writes each ticked one as "M onward") and "Set them myself".
- Settings gets a "Budgets" row in the same group as Categories / Payees (`app/(tabs)/settings.tsx`).

### 5.3 Edit sheet
`KeypadSheet`-based. It contains:
- the title "🍔 Dining" and "Done";
- the large amount;
- "You averaged $540 over the last 3 months" (hidden when there's no history);
- "APPLIES TO" with the segmented "October only | October onward" (default onward);
- the keypad;
- "Remove budget" in negative, shown only when a budget exists. It applies the selected mode.

"Done" with an amount of 0 is treated as Remove.

### 5.4 Category detail — `app/budget/[categoryId].tsx`
- Header "‹ 🍔 Dining" with an "Edit" action that opens the sheet, plus the same glass month pill and month sheet.
- "Left in Dining" card with the thick bar and legend "Paid $X · Scheduled $Y".
- "SCHEDULED · n" lists items with an icon (🔁 for recurring, 📅 for future-dated or pending), the payee or series title, "Oct 22 · Recurring" or "· Future-dated", and a muted amount.
- "PAID · n" lists counted transactions in the month with account and date, using the existing negative amount styling. Tapping one opens the transaction as the Transactions tab does.

## 6. Assistant — `app/(tabs)/index.tsx` (single-exchange layout; no feed)

### 6.1 Routing
New pure module `src/domain/budgetIntent.ts`, run **before** the parse pipeline and the not-a-transaction cues:
- **afford**: text matching the existing `'can-i'` afford cue in `src/domain/notTransactionCues.ts` (keep that regex the single source of truth, and export it) that has an amount (`hasAmountEvidence` / `amountCandidates`). Returns `{ kind: 'afford', amount, subject }`.
- **set budget**: `set|make (my)? <category> budget (to)? <amount>`, `<category> budget (to|=|is)? <amount>`, and `budget <amount> for <category>`. The category resolves with `findCategoryMatch(…, 'expense', …)`:
  - exact match: confirm card;
  - suggestion: "Did you mean Dining?" then the confirm card;
  - no match: for a set, the create offer of §6.5 (a name that cannot be a category keeps the reply "I couldn't find a Dining category." with an "Open Budget" button).
- Verbless forms ("<category> budget <amount>", "budget <amount> for <category>") route only when the category resolves exactly to an existing top-level expense category. "Budget" after at, with or from (the car-rental brand) never routes. A verbless miss falls through to a normal spend, so "Taxi budget 12" logs. Trade-off, accepted at QA: a user with a "Hotel" category who types "Hotel budget 120" meaning a spend gets the budget confirm card. That is reversible, since nothing is written without Confirm.
- Anything else falls through unchanged. "Can I afford" with no amount keeps today's behaviour.

Cues for other question shapes ("should I", "worth", …) are unchanged. `FM_REFUSAL_REPLY` still covers them.

### 6.2 Afford answer
1. **Pick the category.** Run the existing deterministic category inference for a spend (heuristic parse of `subject`, plus payee → default category) without saving anything.
   - It yields a top-level budgeted category: use it.
   - Otherwise: the reply "Which budget would this come from?" with chips for the budgeted categories (attention order, max 6) plus "All budgets". Tapping a chip answers.
2. **No budgets at all:** the reply "You haven't set any budgets yet." with a "Set up budgets" button that pushes `/budget`.
3. **Reply text** (deterministic templates; no model prose for numbers):
   - fits: "Yes. Dining would still have $128 for the next 13 days, about $10 a day." (On the last day: "Yes. Dining would still have $128 this month.")
   - over: "Not from Shopping. It has $120 left, so a $300 phone would put it $180 over." The noun comes from `subject` when the heuristic gives one; otherwise "this would put it $180 over".
   - all budgets: "Yes. All budgets together would still have $363 left." or "Not this month. All budgets together have $663 left."
4. **Afford card** (`src/components/assistant/AffordCard.tsx`, matching the mockup):
   - label "🛍️ Shopping · Oct" with a `Fits` (ok) or `Over` (over) chip;
   - a thick bar with the ghost segment (clamped at 100% plus the cap line when over) and the Today tick;
   - "$180 spent · $300 budget";
   - a divider, then "Left now $120" and "After this −$180" (negative in red, positive in green);
   - when over, the "All budgets together…" line.
5. **Buttons:**
   - fits: **Log it · $60** (primary) and **Not now**;
   - over: **Raise Shopping budget** (opens the edit sheet prefilled with budget + overage, "onward"), **Log it** and **Not now**.

   **Log it** runs the existing draft/confirm flow on the same text with the afford cue stripped, as "Log anyway" does today (`runParse(…, { forceExpense: true })`), with the afford's category preset. Nothing is ever logged without that confirm.

### 6.3 Set-budget confirm
A card in the existing confirm-card pattern:
- the reply "Change Groceries from $400 to $450, starting October?" (or "Set a Groceries budget of $450, starting October?" when none exists);
- the card "🛒 GROCERIES BUDGET" with an `October onward` info chip and "~~$400~~ → $450";
- **Confirm** and **Cancel**. Confirm writes "M onward".

### 6.4 Saved-expense chip
_Superseded by xavier-speech-bubble-spec.md §3–§5: the budget line is now inside the receipt bubble._

After an expense saves from the Assistant and its top-level category has a budget for the transaction's month, the saved card gains a chip. In the current month it reads "🍔 Dining · $175.50 left this month"; for another month, "· left in September". When over, it reads "$21 over this month" in the over style. The chip colour follows the category state.

### 6.5 Amendment (2026-10-04): set, edit and remove by chat, any wording
"Code decides, model fills slots" (as in step 3 and Ask-Xavier). Every path ends on a confirm card the user taps; nothing is written silently.
- **Router first** (`src/domain/budgetIntent.ts`, pure). Adds `edit-budget` (absolute "to 200", or a delta "by 50" that raises or lowers) and `remove-budget`, and widens set-budget: "set a budget of 300$ on food", "I want to spend max 450 on groceries", "cap food at 300 a month", "groceries 450 monthly budget", "limit shopping to 200", "budget 300 for food". Edit verbs: edit/change/update/adjust/make (absolute) and raise/increase/lower/reduce/cut (delta unless "to"). Remove: "remove|delete|clear <cat> budget", "no budget for <cat>", "stop budgeting <cat>". "make my food budget 250" is an edit (it was a set); both show the same Change card.
- **Hijack guards.** Brand "at|with|from Budget" never routes. Forms without a command verb ("cap/limit <cat> to N", "max N on <cat>", "no budget for <cat>", "<cat> budget N") route only when the words are an existing top-level category. "limit hotel 200" (no "to"/"at") and "max 2 coffees 9" stay spends: a hotel called Limit is likelier than a budget command. Zero dev-split transactions route (`evals/test-budget-routes.mjs`).
- **Missing slot -> a question, never a guess:** "set food budget" -> "How much should the Food budget be?"; "set a budget of 300" -> "Which category?". No follow-up state: the reply carries a worked example.
- **Model fallback** (`src/domain/budgetFm.ts`, `deviceParseBudget`), only for text with a budget word plus a command cue, or a cap word plus a monthly marker, that the router did not read. The guided schema is closed: action (set|edit|remove|none), category (enum of the user's top-level expense categories plus "none"), direction (to|raise|lower), and amount only when the text has several readings (enum of those readings; one reading is supplied by code). Code validates: a category outside the list or an amount not from the text becomes a clarifying question; a category the text never names goes through "Did you mean X?" first; "none" falls through as if the model had not been asked. With no model, a line that opens with a budget verb gets the hint "Try: set food budget to 300"; anything else falls through unchanged.
- **Cards and writes.** Set and edit reuse the set-budget card ("Change Food from $300 to $350, starting October?"; delta edits read "Raise Food by $50, from $300 to $350, ..."). Removal shows "Remove Food budget ($300/month)?" with a struck-through amount and writes a NULL-amount "October onward" row (the tombstone of section 3; earlier months keep their budget, backup/restore needs nothing new). All chat writes are "this month onward", shown on the card. Removing a missing budget answers "You don't have a Food budget."; editing a missing one by "to" offers to set it; a delta edit of a missing one, and a lowering to zero or below, answer with a hint instead of a card; setting the amount already in force answers "Food is already $300 a month."
- Pure planning lives in `src/domain/budgetChatPlan.ts`; BDD in `tests/__features__/budgets-chat.feature`.

**Round 2 (review and QA fixes, plus create-a-missing-category)**
- **Order.** The deterministic router still runs first. The model fallback runs only after the query, account and transaction-op gates have declined, just before the parse ladder (`src/domain/intentGate.ts` encodes the order; a test pins the screen to it). "list my budgets please" and "delete coffee 5 from food budget" never reach it.
- **Spends are not swallowed.** A candidate for the model needs a budget word plus a command verb ("please", "want", "need", "like" do not count), or a cap word right next to an amount plus a monthly marker. Only the amount's own slots may follow the amount ("for food", "a month", "please", "from now on"); "budget <noun> 5" is a spend. So "need a budget phone 150", "Netflix 15 per month, max 4 screens", "update my budget app 5", "set groceries budget to 45 at costco" and "raise food budget 5 coffee" all log as spends. A model "none" always falls through; a model clarifying question or ungrounded pick is shown only if the line opens with a budget verb; the hint "Try: set food budget to 300" shows only when there is no model and the line opens with a budget verb.
- **Deltas.** Only "by N" is a delta, and it builds on the ongoing (open-ended) amount, not this month's one-off, because the write is "onward" and replaces the one-off; the card says so. A bare number after a direction verb ("lower food budget 200", "bump food budget 400", "drop shopping budget 20") is the NEW amount. "drop|reset|clear <cat> budget" with no amount removes it (reset = remove).
- **Scope that chat does not do** is answered by code before any model is asked, and never written: several categories ("food and transport") -> one at a time; weekly or daily -> budgets are monthly; "next month" or "this month only" -> chat sets from this month onward, use the Budget screen for a single month; a negative amount -> must be above zero.
- **More forms** when the category exists exactly: "food budget: 300", "budget food 300 monthly", "budget for food 300", "budget for food: 300". "budget 12 food" stays a spend. The bare "budget lunch 12" / "Budget Taxi 12" stays a spend EVEN when the category exists (a dev-split case, "Budget Taxi 12", is a real spend); it routes only with "for", a colon, or a monthly marker ("budget lunch 12 monthly").
- **Missing category.** Set only: a close spelling asks "Did you mean Dining?" with [Dining] / [Create "Dinning"]; otherwise "You don't have a Pets category yet. Create it with a $300 monthly budget?" with [Create & set budget] / [Cancel]. Confirming creates the expense category (top-level, title-cased, name-checked) and writes the budget onward in ONE backup-gated transaction (`createCategoryWithBudget`). Placeholder words ("today", "it", ...), digits and long names are never offered. A name that belongs to a sub-category ("Pets" under Home) or an income category ("Salary") is never offered for creation and never reused: the reply says what it is ("Pets is under Home — budgets are set on top-level categories. Try: set home budget to 300"), and the write path refuses it too. "none", "misc", "other", "stuff" and "things" are not created (an existing category of that name still matches). "remove all budgets" and "set total budget to 2000" are answered up front (one category at a time; budgets are per category). Words about a logged transaction (logged, entry, transaction, expense, purchase, spent) keep a line out of the model fallback, and a model "remove" must match "<cat> budget" / "budget for <cat>". Edit and remove only say "You don't have a Food category." and never offer to create. The category is an ordinary row in the whole-DB backup image, so backup/restore needs no change.

## 7. Acceptance criteria (BDD, `tests/__features__/budgets*.feature`)

1. **Resolution.** A one-off October row overrides an onward September row for October only. An "onward from Nov" write deletes a December one-off. A NULL amount means no budget.
2. **Mockup fixture.** With the mockup's data (budgets 2,100; Dining 600/412; Shopping 300/180; Groceries 400/236; Transport 200/96; Entertainment 150/171; Health 100/20; Bills 350 with 172 paid (Mobile plan Oct 3, $42, and SP Group Oct 9, $130, both posted from recurring series) and 150 scheduled (Singtel Fibre $50, recurring, Oct 22, and AIA Insurance $100, future-dated, Oct 28), so Bills fixed = 322; Gifts 45 not budgeted; today Oct 18) the math gives:
   - left 663, spent 1,287, scheduled 150;
   - the overall chip "A little ahead of pace", per-day 51 and days left 13;
   - Entertainment over by 21, Dining warn, Shopping and Groceries ok;
   - worst 3 = Entertainment, Dining, Shopping;
   - Bills, Transport and Health are ok; the dashboard footer reads "+ 4 more on track";
   - Budget-screen order: Entertainment, Dining, Shopping, Groceries, Bills, Transport, Health;
   - Not budgeted = [Gifts 45].
3. **Dedupe.** A recurring occurrence already posted for Oct 22 is counted once, as spent and not also as scheduled. A skipped date isn't counted at all, and neither is a paused series.
4. **What counts.** Transfers and income don't count, a refund reduces spend, a child category rolls into its parent, and an archived account's expense counts.
5. **Pace.** A bill paid on the 1st doesn't push the category to warn. Days left and per-day are right on the 1st, mid-month and the last day.
6. **Dashboard visibility.** The card shows for a single month and is hidden for a year and for a custom range. It is the same with and without an account filter.
7. **Suggestions.** The 3-month average rounds to $10, and the $50 tick rule holds.
8. **Afford.** "can I afford a 300 phone" and "can afford 300$ phone" route to afford with amount 300. "can I afford it" (no amount) keeps today's refusal. "I can afford 300 phone now, bought it" still logs. The fits/over verdict, `after` and the all-budgets line are right.
9. **Set budget.** "set groceries budget to 450", "groceries budget 450" and "budget 450 for groceries" route to set-budget. "Budget Rent a Car 85" and "budget airline ticket 120" still log as spends. Edit and remove wordings route to their own confirm cards (§6.5).
10. **Backup.** Budgets round-trip through the SQLite-image backup/restore.
11. **SQL.** Only parameterised queries in the budgets repository (lint/grep test as for other repositories).
12. **Checks.** `npm run typecheck`, `npm run lint`, `npm test` and `npm run eval` are green. Eval corpora (`tests/intent-corpus.jsonl`, `evals/`) change only where a case's expected label encoded the old refusal of an afford-with-amount or set-budget text. Each changed label is listed in the ship-run record.

## 8. Edge cases
- A category is renamed: budgets follow the id. A category is deleted: its budget rows are removed. A category becomes a child: its budget is ignored, because only top-level categories have budgets, and the Budget screen shows it under its parent.
- Budget 0 isn't allowed. It is treated as Remove.
- Multi-currency: count the same transactions `totalsForRange` counts for the app currency; don't convert.
- The month changes while the app is open: the existing `useFocusReload` / AppState refresh recomputes.
- Very long category names truncate to one line. Amounts use tabular numbers.
- Biometric lock: unchanged. New screens sit behind the same gate as every route.

## 9. Constraints
- Domain logic stays framework-free and BDD-tested in plain Node.
- SQL is parameterised only, and inputs are validated with zod at the repository boundary.
- No network. Everything is computed on the device.
- Reuse tokens and components; no new colours. The hatch pattern reuses `muted` / `primary` / `negative`.

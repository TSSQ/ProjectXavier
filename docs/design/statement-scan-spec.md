# Spec: Scan statement — model-free multi-transaction capture from one screenshot

**Branch:** `claude/repeat-parity` · **Status:** approved 2026-09-02 (§8 decided) · implementing · **Date:** 2026-09-02
**Builds on:** `src/domain/draftQueue.ts` (committed + tested, never wired), `modules/apple-ocr`, and the 2026-09-02 Mac probe (memory `multi-tx-probe-findings`; reference implementation `rows2.mjs` in the session scratchpad `multi-probe/`).

## 1. Objective

Let the user screenshot a bank app's transaction list, pick **Scan statement**, and review the rows one card at a time — amount, sign, date and merchant text lifted straight from the screenshot's layout, no model in the loop. Six rows in, six drafts out, with nothing invented: every amount shown is a number that is literally printed on the screenshot.

## 2. Verified starting state

### 2.1 What the app does today

- `modules/apple-ocr/ios/AppleOcrModule.swift` → `recognizeText(uri)` runs `VNRecognizeTextRequest` (`.accurate`, language correction) and returns `topCandidates(1)` strings **joined with `\n`**. Bounding boxes are discarded.
- `app/(tabs)/index.tsx` `ocrReceipt(uri)` (~line 2165): `getRecognizer().recognize` → `classifyOcrText` → `runParse(text)` → Foundation Models / heuristic → `interpret()` → **one** `TransactionDraft` → `DraftCard`. The scan `ContextMenu` (~line 2546) has two items, `Take photo` and `Choose from library`.
- `src/domain/draftQueue.ts` already models the review phase (`startQueue`, `currentDraft`, `decideCurrent`, `queueDone`, `queueSummary`, `reviewProgress`) — 8 scenarios in `tests/__features__/draft-queue.feature`. Nothing calls it.

### 2.2 What the probe showed (three real screenshots, 5 runs each)

| Input | Vision's `\n` order | Layout rebuild (boxes) | Foundation Models (3B) |
|---|---|---|---|
| bank1 — desktop-style list, 6 rows, "25 Aug" header, `-4008` card suffix per row | **column-major**: 6 descriptions, then 6 amounts | 6/6 rows, right amount/sign/date | list schema on rows: took `-4008` as the amount 3/5; per-row: date 0/30 (ignores "25 Aug"), category ~random, hallucinated a known payee on 3/5 rows |
| OCBC phone app — amount on its own line under the block, `SGD - 1.50` / `SGD + 1,198.30`, `Today`/`Yesterday` headers, 20-digit references | row-by-row | 4/4 rows, income sign + thousands separator right, no reference taken as an amount | not run (nothing left for it to add) |
| Stuff'd order receipt — line items + Subtotal/GST/TOTAL | column-major | classified `receipt`, **not split**, total S$8.30 found | — |

The joined text the app feeds its parsers therefore never reliably contains a *row*: the earlier "6 rows → 1 transaction" failure was the parser being handed columns, not a model limitation the model could be prompted out of. With rows reconstructed from geometry, the model had no field left where it was better than a regex, and several where it was wrong (`localParse` also returned 4008.00 for every bank1 row).

### 2.3 Design consequence

The statement path is deterministic end to end. The model's only remaining role — naming/categorising a merchant string — is done by the existing payee memory (`findPayeeMatch` + the payee's learned `defaultCategoryId`) and, failing that, by the user on the card, exactly as the chat path already does with "Use Starbucks".

## 3. Scope

**In**
1. Native: a second OCR function returning observations **with normalised bounding boxes**.
2. Domain: geometry → lines → blocks → transaction rows; receipt detection; all pure, tested in Node against the three recorded observation sets.
3. Domain: row → `TransactionDraft` (description cleanup, sign → type, date header resolution, payee/category memory, transfer hint, likely-duplicate flag).
4. Screen: `Scan statement` menu item; account choice; one-card-at-a-time review with a progress bar; honest end summary.
5. A receipt handed to the statement path stays **one** transaction.

**Out** (explicitly)
- Multi-photo batches (the PARSING phase of `draftQueue`) — separate spec once single-shot is proven.
- Cloud BYOK image parsing (would widen what leaves the device; nothing here needs it).
- Per-bank templates or a merchant-name dictionary beyond the user's own payees.
- Changing the existing single-receipt path (`Take photo` / `Choose from library`) — see §9.
- Android.

## 4. Approach

### 4.1 Native — observations with boxes

`modules/apple-ocr/ios/AppleOcrModule.swift`: add

```swift
AsyncFunction("recognizeObservations") { (uri: String) throws -> [[String: Any]] in
  try recognizeObservations(atFileUri: uri)   // [{ text, x, y, w, h }]
}
```

Same request configuration as `recognizeText` (`.accurate`, `usesLanguageCorrection = true`, `VNImageRequestHandler(url:)`, no orientation override) — the two functions must stay configured identically so text seen by one is text seen by the other. Boxes are Vision's normalised `boundingBox` **converted to top-left origin**: `x = minX, y = 1 - maxY, w = width, h = height`. `recognizeText` is untouched; the existing receipt flow keeps working unchanged.

`modules/apple-ocr/index.ts`: add `recognizeObservations(uri: string): Promise<unknown>` to the interface (typed `unknown` on purpose — the boundary is validated below).

`src/features/ocr/recognizer.ts`: extend `TextRecognizer` with `recognizeLayout(imageUri): Promise<OcrObservation[]>`; `unconfiguredRecognizer` throws for it the same way it does for `recognize`. `appleVisionRecognizer.recognizeLayout` calls the native function and parses the result with a zod schema (guardrail #6 — OCR output is untrusted):

```ts
// src/domain/ocrObservation.ts
export const ocrObservationSchema = z.object({
  text: z.string().max(500),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0).max(1), h: z.number().min(0).max(1),
});
export const ocrObservationsSchema = z.array(ocrObservationSchema).max(2000);
```

No `expo prebuild`; `ios/` is hand-maintained. The module is already autolinked, so adding a function to the existing Swift file needs only a rebuild.

### 4.2 Domain — `src/domain/statementLayout.ts` (pure)

`reconstructLayout(observations: OcrObservation[]): StatementLayout` — the `rows2.mjs` algorithm, transcribed:

```ts
export interface LayoutRow {
  /** Text of the nearest date-only line above this row, or null. */
  dateText: string | null;
  /** Major units as printed, e.g. 1198.3. */
  value: number;
  sign: '-' | '+' | '?';
  /** All non-amount text in the block, x-sorted within each line, lines joined by ' '. Uncleaned. */
  description: string;
  /** The amount token as printed ("SGD - 1.50", "-16.74") — for the honesty check. */
  amountText: string;
  /** ISO 4217 code parsed from the amount token's own currency symbol/code
   *  ("USD 12.99" → "USD", "S$ 8.30" → "SGD"), or null when none was
   *  printed, or only a bare "$" (ambiguous, never a claim). Reviewer B3. */
  currency: string | null;
}
export interface StatementLayout {
  kind: 'statement' | 'single' | 'receipt' | 'unknown';
  rows: LayoutRow[];
  /** Text of kept lines above the first row (bank / account header), for account matching. */
  headerText: string;
  /** The TOTAL / Grand total / Amount due amount, when kind === 'receipt'. */
  receiptTotal: { value: number; text: string } | null;
  /** Count of amount-bearing LINES inside dropped multi-amount blocks — a
   *  dual-currency line is 1, three separate single-amount lines merged
   *  into one block are 3. Feeds the end-of-queue summary. */
  unreadRows: number;
  /** All observation text joined with '\n' in Vision order — what the existing single flow expects. */
  text: string;
}
```

Steps (all thresholds relative to `medH`, the median observation height, so they are resolution-independent):

1. **Lines.** Sort by centre-y. Merge an observation into the current line when `|line.cy − o.cy| < 0.6 × medH`; the line's `cy` is the running mean, `top`/`bottom` the min/max extents.
2. **Parts.** Within a line sort by `x`. A part is an **amount** if its trimmed text fully matches
   `^CUR?\s*([-+])?\s*CUR?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(CR|DR)?$` (`CUR = [A-Z]{3}|S\$|US\$|\$|€|£`, case-insensitive). Two decimals are mandatory — that is what keeps `-4008`, `PLPE4624509251917590`, `M972` and `App 3.2` out. Everything else in the line is text, joined with a space.
3. **Date lines.** No amount, text ≤ 24 chars, matches `^(today|yesterday)\b | ^\d{1,2}\s+MONTH(\s+\d{4})?$ | ^MONTH,?\s+\d{1,2}(\s+\d{4})?$ | ^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$`, where `MONTH = (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*` (reviewer MINOR 2) — without requiring a real month name, the same two patterns also matched "2 Pending", "Order 12", "Table 5", turning ordinary UI/receipt text into a phantom date line.
4. **Noise.** Lines with no amount and no alphanumeric character are dropped (icons, dots).
5. **Blocks.** Vertical gaps between consecutive kept lines are sorted; the split threshold is the midpoint of the largest relative jump (`gap[i] / gap[i−1] > 1.8`, only among gaps `> 0.5 × medH`). **No gap-based split when no jump qualifies** (QA re-gate): without a signal any split is a guess — the earlier `medH` fallback split a uniformly-spaced description-above/amount-below list inconsistently on floating-point noise and paired the wrong merchant with an amount, the one outcome this feature must never produce. A new block starts when the gap exceeds the threshold, or on either side of a date line. **Self-contained split (QA M2, extended by QA follow-up):** after gap-based blocks are formed, a block holding ≥2 amount-bearing lines in which *every* line is self-contained — at least one amount part plus at least one non-amount text part on the same line (a plain single-amount row and a dual-currency row are both self-contained) — is split into one block per line. This is the uniformly-spaced single-line list (no gap jump exists, so with no threshold split the whole list would otherwise merge into one dropped block). Each split-out line is then classified on its own: exactly one amount is a row, more than one (a dual-currency line) contributes to `unreadRows`. Blocks containing an amount-only or a description-only line keep the drop-the-whole-block behaviour: attaching those lines to a neighbour without a gap signal would be a guess in one of the two real layouts (bank1's continuation line is *below* the amount line, OCBC's description is *above*), and a confidently-wrong merchant is worse than an honest drop.
6. **Classify blocks.** A lone date line sets `dateText` for following rows. A date line may carry an optional leading weekday (`Wednesday, 25 August 2026`), stripped before matching. A block with a line matching `^(total|sub ?-?total|subtot|grand total|amount due|gst|tax|service charge)\b` is **never a row** (rule (i), unconditionally) — but it's only a **receipt signal** when its own non-amount text does *not* also match balance vocabulary `/\b(balance|available|assets|credit|limit|outstanding|spent|spending|payable|owed|savings|net worth)\b/i` (reviewer B2): a bank-statement header like `Total balance 12,480.55` matches the total-family shape but is a running balance, not a receipt total, and must set neither `receiptSignal` nor `receiptTotal`. Each genuine signal line belongs to one of three families — `subtotal`, `tax` (`gst|tax|service charge`), `total` (`total|grand total|amount due`) — tracked with the block index it occurred at. After every block is visited: `kind` is only `'receipt'` when either (a) ≥ 2 **distinct** signal families were seen anywhere, or (b) exactly one family was seen, **every** signal block's index is *after* the last row block's index (a footer, not a header), **and** no date line was detected anywhere in the layout (a dated transaction list is a statement, however its footer is worded). Otherwise `kind` falls through to the ordinary row-count rule (statement/single/unknown) and `receiptTotal` stays null — the total-family block(s) are still excluded from `rows`, just not treated as a receipt. A block with **exactly one** amount (and no total-family line) is a row; a block with more than one amount is dropped, and every amount-bearing line inside it adds to `unreadRows` (a dual-currency line is 1; several merged single-amount lines are that many).
7. **Amount.** `value = parseFloat(digits without commas)`. `sign`/`currency` are read from the SAME `AMOUNT_RE` match's own capture groups, not by re-scanning the matched text (reviewer MINOR 1 — a currency *code* can itself contain "DR"/"CR" as a substring, e.g. `IDR 150.00`, `CRC 150.00`, which a whole-string scan misreads as a debit/credit marker): `sign` is `-` for a captured `-` or `DR`, `+` for `+` or `CR`, else `?`; `currency` is the captured currency token mapped to an ISO code (`[A-Z]{3}` → itself, `S$` → `SGD`, `US$` → `USD`, `€` → `EUR`, `£` → `GBP`, bare `$` or none printed → `null`).
8. **Kind.** Any receipt signal → `receipt` (`receiptTotal` = the `grand total` line, else `total`, else `amount due`; never subtotal). Otherwise `statement` for > 1 row, `single` for 1, `unknown` for 0.

### 4.3 Domain — `src/domain/statementDrafts.ts` (pure)

`rowsToDrafts(layout, ctx): { drafts: TransactionDraft[]; dropped: number }` where `ctx = { account: Account; accounts: Account[]; payees: Payee[]; categories: Category[]; existing: Transaction[]; now: number }`.

Per row:

- **amount** = `toMinorUnits(value, account.currency)` (`src/domain/money.ts`) — never the row's OWN printed currency, ask-never-convert (CLAUDE.md #3). Rows with value 0 are dropped (`dropped++`). When `currencyConflict(row.currency, account.currency)` is true (`src/domain/currencyConflict.ts`) — a row that printed its own currency and it differs from the account's, e.g. `AMAZON MKTPLACE USD 12.99` against an SGD account — the draft gets `mismatchedCurrency: row.currency` (reviewer B3), the same field/card-warning/Save→Edit-reroute the chat path already has; a bare `$` (`row.currency === null`) is never a claim, so it never trips this.
- **type**: `+` → `income`; `-` or `?` → `expense`. Unsigned rows are the common statement case (debits printed bare) and the card shows the type for correction.
- **occurredAt** via a small `resolveStatementDate(dateText, now)`: first `resolveAbsoluteDate(dateText, now)` (`src/domain/deviceParsePrompt.ts`, already exported; handles `25 Aug`, `2 Sep 2026`, `02/09/2026` — and therefore `Today, 2 Sep 2026` by its printed date, which is right even for a week-old screenshot). If that result is **after `now`**, subtract one year: `resolveAbsoluteDate` deliberately no longer rolls back (the chat path's `interpret()` future guard does that job), and a statement is never in the future — but the roll-back itself is an ASSUMPTION, not something read off the page, so it also sets `defaulted.date = true` (reviewer MINOR 4) so the card offers it for confirmation; a printed date resolved WITHOUT a roll-back stays `defaulted.date = false`. The roll-back (`oneYearBefore`) clamps 29 Feb to 28 Feb when the rolled-back year isn't a leap year. Only a bare `Today` / `Yesterday` with no printed date falls back to `localDayNoon(now)` / `addLocalDays(localDayNoon(now), −1)` (`defaulted.date = false` — real text, just imprecise). Null → `now`, `defaulted.date = true`.
- **description cleanup** (deterministic, on whitespace tokens, in this order):
  1. drop `^-\d{4}$` (card suffix);
  2. drop any token containing ≥ 6 consecutive digits (references, `OCBC:510586811001:I-BANK`);
  3. drop bank/noise tokens, exact case-insensitive match: `ADV ADVICE OTHR ICT TRF SG SGP SINGAPORE • · : -`;
  4. un-glue a trailing `SINGAPORE`/`SG` from a token when ≥ 3 letters remain (`InvestmentSINGAPORE` → `Investment`);
  5. join, cut an unmatched trailing `(` fragment (`OLD TEA HUT (CENTUR` → `OLD TEA HUT`), collapse whitespace, trim edge punctuation.
  Empty result → `payeeName = null`, `defaulted.payee = true`.
- **payee / category**: `findStatementPayeeMatch(cleaned, payees)` = `findPayeeMatch` plus a statement-only third net: when neither `exact` nor `suggestion` came back, a payee whose normalised name (≥4 chars) is a whole-word **prefix** of the normalised description is offered as the `suggestion` (longest wins) — bank descriptions are routinely `<merchant> <legal suffix / branch>` ("Kopitiam Investment", "NTUC FairPrice App"), which `findPayeeMatch`'s ≥50 % length guard rightly rejects for typed input. `exact` → adopt the payee's name and its `defaultCategoryId`'s name (`defaulted.category = false`). Otherwise `payeeName = cleaned`, `categoryName = null`, `defaulted.category = true`; the `suggestion` is surfaced by the card exactly as the chat path does ("Use Kopitiam / Keep"; accepting it inherits the learned default category on save via `resolveCategoryId`). No keyword-to-category guessing.
- **transfer**: `transferHint = /\b(TRF|ICT|TRANSFER|TOP-?UP|PAYNOW|FAST|GIRO|IBFT)\b/i` on the **raw** description. When set, `findAccountMatch(cleaned, accounts minus the source)` returning an `account` (never a `suggestion`, never `ambiguous`) with **confidence ≥ 0.85** (reviewer M1 — the name-based match levels only; `findAccountMatch`'s own subtype-cue rung, 0.7/0.75, is confident enough to ANSWER "which account?" in chat but not to silently turn a row into a transfer and discard its payee, e.g. `PAYNOW TO JANE CASH GIFT` against a cash account) makes the draft `type: 'transfer'` with `transferAccountId/Name`; otherwise the draft keeps its expense/income type and carries `transferHint: true` (new optional presentation-only field on `TransactionDraft`, beside `defaulted`) so the card can say "Looks like a transfer — Edit to pick the account."
- **likely duplicate**: `findLikelyDuplicate(draft, existing)` — same `amount`, same `type`, `isSameDay(occurredAt)`, and same `accountId` (always the account the user picked up front — §4.4 point 4 — so no "or defaulted" fallback is needed here, unlike the chat path; reviewer MINOR 9). Sets `duplicateOf?: { id, label }` (presentation-only) for the card's warning. Never auto-skips.
- `source: 'ai'` (the persisted `TransactionSource` union has no closer value; adding one touches the schema and is not worth it here), `sourceText` = the raw row description + amount text, `accountId = account.id`, `defaulted.account = false` (the user chose it — §4.4).

### 4.4 Screen — `app/(tabs)/index.tsx`

1. **Entry.** Third `ContextMenu` item `Scan statement` (Feather `list`), after `Choose from library`. It opens the photo library only (a statement is a screenshot; the camera path stays receipt-only). Widget `?scan=1` is unchanged (opens the same menu).
2. **Recognise.** `setBusy(true)` → `getRecognizer().recognizeLayout(uri)` → `reconstructLayout` — one native call, ~1–2 s, existing spinner. Failures use the existing copy ("I couldn't read that photo — try a clearer shot."); zero observations use the existing empty-text copy. The wall-clock cost of this step is recorded as the real `latencyMs` on the FIRST card's own `recordParse` call (reviewer MINOR 10), not `0`.
3. **Route on `kind`.**
   - `statement` / `single` → step 4.
   - `receipt` → §4.5.
   - `unknown` → reply: "I couldn't find any amounts on that screenshot. Statements work best as a full-screen screenshot of the transaction list."
4. **Account.** If the user has one account, use it. Otherwise open `AccountPickerSheet` (`src/components/ui/AccountPickerSheet.tsx`) titled "Which account is this statement from?", `selectedId` pre-set from `findAccountMatch(layout.headerText, accounts)` when it returns an unambiguous `account`, else the default account. Closing without choosing cancels the scan. `ctx.accounts` for `rowsToDrafts` (and so the transfer-target search) is the same active-only (non-archived) account list the picker itself offers, not the raw unfiltered list (reviewer MINOR 7).
   - **Cheap pre-cap.** Before the account step, if `layout.rows.filter(r => r.value > 0).length > MAX_STATEMENT_ROWS` (60), reply "That's more than 60 rows — scan it in two screenshots." without spending a `listTransactions()` round-trip or building any drafts (reviewer MINOR 8). The post-`rowsToDrafts` cap on the drafts array (§6) stays as belt-and-braces.
5. **Queue.** `rowsToDrafts` → `startQueue(drafts)` held in new state `queue: DraftQueue | null`. While a queue is active, `pending` mirrors `currentDraft(queue)` so the existing `DraftCard`, payee/category suggestion state, Edit sheet and `saveAssistantDraft` path are reused untouched. Above the card: a progress bar (fraction = decided/total) + `reviewProgress(queue).label`, which is the card being **shown**, 1-indexed and capped at total ("2 of 6" while reviewing the second card — not how many are already decided, which read a card behind; reviewer MINOR 6). The reply when the queue first starts is real copy ("Found 6 rows — let's go through them."), not that label. The card's discard action is labelled **Skip** while a queue is active.
   - Save → `saveAssistantDraft(pending)` → `decideCurrent(queue, 'saved')`; Skip → `decideCurrent(queue, 'skipped')`; Edit → existing sheet, its save counts as `saved`. Each decision **awaits** the advance (reviewer MINOR 11 — the new card's own `recordLayoutParse` must finish before the screen is interactive again, or a fast double-decision can attach card N's outcome to card N+1's parse id) and recomputes the payee suggestion for it. `payeeSwappedRef` resets to `false` on every advance (reviewer M2 — otherwise "Use Kopitiam" on card 1 marks every later card's metric row `payeeSwapped: true` too).
   - **Stop reviewing** link under the card: remaining cards become `skipped`, queue ends. Guarded on `busy` and disabled while `busy` (reviewer M4) — otherwise an in-flight Save could race it and resurrect an already-ended queue; the advance itself uses a functional `setQueue` that refuses to resurrect a queue some other decision already nulled.
   - `queueDone` → reply from the pure `statementSummary(queue, unread)` (`src/domain/draftQueue.ts`, reviewer MINOR 5): "Saved 5 of 6 from your statement, 1 skipped." plus ", N rows couldn't be read" when `unread = dropped + layout.unreadRows > 0` — the domain's `dropped` counts zero-value rows; the screen adds `unreadRows`, the amount-bearing lines inside multi-amount blocks `reconstructLayout` already excluded (QA M1, counted per line not per block per the QA follow-up). Then `queue = null`.
6. **Source chip.** `ParseSource` gains `'layout'`; the card shows it as "From screenshot". Metrics: one `recordParse`/`resolveParse` pair per draft with engine label `'layout'`, so the export (memory `parse-metrics-export-plan`) reports accept/edit rates for this path like the others.
7. **Busy/guards.** `onScan` already no-ops while busy. Starting a statement scan clears any pending chat draft/queue (same reset block `runParse` uses). The account-picker's `onSelect` call into `beginStatementQueue` is void-ed (the sheet has already closed) and so gets its own `.catch` reply ("I couldn't read that photo — try a clearer shot.") — otherwise a `listTransactions()`/`rowsToDrafts` failure there is an unhandled rejection with no user-facing reply at all (reviewer M3); `busy` itself is already guaranteed clear either way by `beginStatementQueue`'s own `finally`.

### 4.5 A receipt in the statement path

`kind === 'receipt'` → hand `layout.text` through the SAME `classifyOcrText` step `ocrReceipt` itself uses (one entry point, no divergence — reviewer MINOR 12; an empty-text result gets the existing "I couldn't find any text on that receipt" copy) before the existing `runParse(text)` (unchanged behaviour otherwise: one draft), then, when `layout.receiptTotal` is set, replace the draft's `amount` with `toMinorUnits(receiptTotal.value, …)` via a pure `applyReceiptTotal(draft, layout)` and set `defaulted`-style flag `amountFromTotal: true` for the card copy "Amount taken from the receipt's TOTAL line." The model never picks the number when the layout has already found the total.

### 4.6 Fixtures

The three recorded observation sets become `tests/fixtures/statement/{bank1,ocbc,receipt}.observations.json` **after sanitising**: every token with ≥ 6 consecutive digits is replaced by synthetic digits of the same length, and the PayLah nickname is replaced with `Alex`. Geometry, amounts, dates and merchant strings are kept verbatim — they are what the algorithm is tested on. (The screenshots themselves are not committed.)

## 5. Acceptance criteria

All BDD, plain Node, no native code. Amounts are minor units.

**Layout (`statementLayout`)**
1. bank1 → `kind: 'statement'`, 6 rows, values `[16.74, 3.2, 1.6, 1.8, 2.1, 5.2]`, all `sign: '-'`, all `dateText: '25 Aug'`, `unreadRows: 0`. No row's `value` is 4008 or 9814.
2. OCBC → `kind: 'statement'`, 4 rows: `(1.5, '-', 'Today, 2 Sep 2026')`, `(100, '-', 'Today, 2 Sep 2026')`, `(1198.3, '+', 'Today, 2 Sep 2026')`, `(482.45, '-', 'Yesterday, 1 Sep 2026')`. No row value equals any reference number.
3. Receipt → `kind: 'receipt'`, `rows: []`, `receiptTotal.value === 8.3`, `unreadRows ≥ 1`.
4. Honesty: for every row, `amountText` is the text of exactly one observation, and `value` is the number printed in it. (Scenario iterates all three fixtures.)
5. Scaling every box by 0.5 (or shifting all by +0.1) yields identical rows — thresholds are relative.
6. The `\n`-joined `text` equals the observations' text in input order (what the single flow gets).

**Drafts (`statementDrafts`, `now = 2026-09-02T12:00 local`, account currency SGD)**
7. bank1 with payees `[Kopitiam → Food]`: 6 expense drafts, amounts `[1674, 320, 160, 180, 210, 520]`, every `occurredAt` on 2026-08-25, `defaulted.date === false`. Payee names: `Kopitiam Investment` (`findStatementPayeeMatch` → suggestion `Kopitiam`; `categoryName` stays `null`, `defaulted.category === true` until the user taps Use), `NTUC FairPrice App`, `OLD TEA HUT` ×3, `COCONUT PIN`. No draft's payee contains `4008`, `9814`, `SINGAPORE`, `SG` or `(`.
8. OCBC: drafts `[150 expense, 10000 expense, 119830 income, 48245 expense]`; the first three on 2026-09-02 and the fourth on 2026-09-01; all four `transferHint === true`; no payee name contains a token with ≥ 6 consecutive digits or any of `ADV ADVICE OTHR ICT TRF`.
9. OCBC with an account named `PayLah` in `accounts`: rows 1–2 become `type: 'transfer'` with `transferAccountId` = PayLah's id; rows 3–4 do not (no destination matched) and keep `transferHint`.
10. A row whose `dateText` is null gets `occurredAt === now` and `defaulted.date === true`. `25 Aug` seen on 2026-08-20 resolves to 2025-08-25 (verified: `resolveAbsoluteDate` alone returns 2026-08-25 there, so the roll-back must be the statement resolver's). `Today, 2 Sep 2026` seen on 2026-09-09 resolves to 2026-09-02; bare `Today` on 2026-09-09 resolves to 2026-09-09.
11. Exact payee match adopts the payee's name and its default category name; no match leaves `categoryName` null and `defaulted.category === true`. No draft ever gets a category from a keyword.
12. Duplicate: an existing SGD 16.74 expense on 2026-08-25 in the same account flags bank1 row 1 with `duplicateOf`; the same amount on 2026-08-26, or as income, does not. Flags never remove a draft.
13. Every draft passes the existing draft/transaction zod validation on save (`saveAssistantDraft` round-trips in the BDD DB harness for one bank1 draft).

**Screen / flow (BDD where pure; the rest on device)**
14. `draftQueue` scenarios still pass; a new scenario covers "Stop reviewing" (remaining → skipped, `queueSummary` counts them).
15. `applyReceiptTotal` replaces the amount only when `receiptTotal` is present and flags `amountFromTotal`; without a total the draft is unchanged.
16. Native boundary: `ocrObservationsSchema` rejects a box outside 0..1 and a non-array; a rejected payload surfaces as the "couldn't read that photo" copy, never a crash.
17. `rtk proxy grep -nE "\bgenerateObject\b|\bdeviceParse\s*\(|features/ai/deviceParse\b|\bopenaiParse\b|\banthropicParse\b" src/domain/statementLayout.ts src/domain/statementDrafts.ts` is empty — no model call in the statement path (source-grep scenario, same pattern as `tests/__steps__/account-delete-routing.steps.ts`). The pattern names the model-calling identifiers, not filenames: `statementDrafts.ts` legitimately imports the regex-only `resolveAbsoluteDate` from `deviceParsePrompt.ts`.
18. On device (build for Pigu): the three original screenshots produce the rows above; reviewing bank1 end-to-end saves 6 transactions with the right dates and amounts in the chosen account; Skip and Stop reviewing behave as specified; the receipt produces one card with amount S$8.30.

## 6. Constraints

- No network, no model, no new permissions. The image and every observation stay on device (guardrail #3/#5); `sourceText` persists only the row's own text.
- Guardrail #6: native output crosses a zod boundary; nothing downstream trusts shapes.
- `src/domain/*` stays framework-free (plain Node BDD suite).
- `ios/` is hand-maintained: no `expo prebuild`, no `eas build --local`. The native change is confined to the existing module file + `index.ts`.
- `TransactionDraft` gains only presentation-only optional fields (`transferHint`, `duplicateOf`, `amountFromTotal`); nothing new is persisted.
- Statement rows are capped at 60 per scan; beyond that, reply "That's more than 60 rows — scan it in two screenshots." (bank screenshots hold 5–15).

## 7. Edge cases

- **Amount printed on the next line** (OCBC) vs **same line** (bank1): handled by the block split, both fixtures.
- **Pending / declined tabs and status bar text** ("Pending", "Declined", "12:07", "5G"): no amount → not rows; may land in `headerText`, which is only used for account matching.
- **Two amounts in one block** (a foreign-currency row printing `USD 12.00` and `SGD 16.20`): counted as a table, dropped, reported in the summary as "rows couldn't be read" — honest, if blunt. Follow-up in §9.
- **Balance column** (some banks print a running balance per row): also two amounts per block → dropped. Same follow-up.
- **Unsigned amounts**: `?` → expense; the card shows it. Income-only screens (payslips) will be wrong per row but visibly so.
- **Year rollover**: `25 Aug` scanned in January resolves to last year (statement resolver's roll-back, §4.3) — and, being an assumption rather than a printed fact, flags `defaulted.date = true` so the card offers it for confirmation (reviewer MINOR 4). A bare `Today` header with no printed date is the device's today, not the screenshot's — a week-old screenshot would get today's date; the card shows the date and it is one tap to edit. OCBC prints the date beside it, so that fixture is exact.
- **Duplicate scans** of the same screenshot: every row flags `duplicateOf`; the user skips through or taps Stop reviewing.
- **Rotated / cropped / zoomed screenshots**: thresholds are relative to `medH`, so zoom is fine; cropping that cuts the amount column produces `unknown` and the copy in §4.4.3.
- **Vision merges neighbouring words** (`InvestmentSINGAPORE`): step 4 of cleanup; other merges stay as-is in the payee name for the user to fix.
- **Same merchant, several rows** (`OLD TEA HUT` ×3): three drafts, three cards; each learns/uses the same payee.

## 8. Decisions (taken 2026-09-02)

1. **Account choice** — ask once up front (`AccountPickerSheet`) when there is more than one account, pre-selected from the header. (Alternative rejected: default account on every card, fixed per card in Edit.)
2. **Likely duplicates** — flag on the card, never auto-skip. (Alternative rejected: auto-skip with a count in the summary.)
3. **Fixtures** — commit the observation JSON with references/nicknames replaced (§4.6). (Alternative rejected: keep fixtures out of git.)

## 9. Follow-ups (not this spec)
- **Unrecognised amount contaminates a neighbour's description** (QA final pass): when a row's amount is not captured as an amount at all (garbled OCR token, not merely differently formatted) and it sits in a uniform no-jump run next to a real row, its description text is concatenated onto that neighbour (`"Zephyr Bakery Umbrella Corp"` on `-2.00`). The amount stays the correct line's own, and the glued two-name string is visible on the card, so it is a contamination rather than a swap; a text-only line adjacent to a self-contained line could be split off once real screenshots show how often this occurs.
- **Receipt with Subtotal/GST but no Total / Grand total / Amount due** (cropped receipt): `kind` is `receipt` but `receiptTotal` is `null`, so the draft's amount comes from the pre-existing `runParse(layout.text)` path with no `amountFromTotal` flag — unchanged from before this spec, but the card cannot tell the user the deterministic path was skipped (QA M4).
- **Receipt-kind gate trade-offs** (review re-gate, §4.2 step 6). Rule (b) — a single signal family counts as receipt evidence only when every signal sits below the last row AND no date-only line was seen — has one false negative and one residual false positive, both pinned by honest scenarios in `statement-layout.feature`:
  - *False negative:* a receipt printing a bare date on its own line (`02 Sep 2026`) with only a `TOTAL` line and no Subtotal/GST is classified `statement`, so `Latte 5.50` / `Croissant 3.80` become two cards instead of one 9.30 transaction. Needs both a date-only line (most receipts print date+time together, which the date patterns reject) and a single signal family; the failure is granularity, every amount shown is real, and Stop reviewing is one tap away.
  - *Residual false positive:* an UNDATED list whose rows carry their date inline (`25/08 Kopitiam -4.50` … `Total 1,965.50`) has no date-only line, so a plain footer `Total` / `Total debits` / `Amount due` still flips it to `receipt` and the footer amount is drafted as one expense. Narrower than the original B2 (a header anywhere on the screen) and not reachable by either recorded screenshot.
  - *Proposed fix:* replace rule (b)'s `!dateLineSeen` with a sum check — a single-family footer counts as receipt evidence when its value equals the sum of the row MAGNITUDES above it within a cent (signed sums false-positive on the residual case: `-4.50 -30.00 +2000.00 = 1965.50`). Verified against all three repros by the reviewer. Not slipped in at the gate because it also changes an undated receipt with one dropped qty×price line (rows no longer sum to the total → `statement`); keep `rows.length === 0 && !dateLineSeen` as a fallback and run it through its own QA pass.

- Route the existing `Take photo` / `Choose from library` receipt path through `reconstructLayout` too, so the amount comes from the TOTAL line before any model runs.
- Rows with two amounts: prefer the amount in the account's currency, or the right-most column.
- Learned aliases: remembering that `TOP-UP TO PAYLAH!` was saved as `PayLah top-up` so the next scan pre-fills it (`findPayeeMatch` only sees payee *names* today).
- Multi-photo statements (long lists that need two screenshots) — the `draftQueue` PARSING phase.
- The chat splitter for "lunch 12, coffee 4.50, taxi 20" (three amounts → three drafts through the same queue) — same review UI, different producer.

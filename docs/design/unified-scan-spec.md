# Unified scan — one photo entry, the layout decides the path

Status: **approved 2026-09-03** (user: "fold statement + photo into 1 — based on
number of transactions system chooses which path to take"). Follow-up #1 of
`docs/design/statement-scan-spec.md` §9. Branch `claude/repeat-parity`
(worktree `.claude/worktrees/fm-spike`).

## 1. Objective

Any image the user hands Xavier — camera or library — goes through the same
on-device layout rebuild, and **the number of transaction rows the layout
finds decides what happens next**: two or more rows → the statement review
queue (one card per row, account asked once up front); otherwise → one
transaction, exactly as the receipt path works today (amount from the
TOTAL line when the layout found one). The user never has to know, or
choose, whether their picture is "a receipt" or "a statement".

## 2. Verified starting state (build 93, commit `d3e5fcc`)

- `app/(tabs)/index.tsx` has **two** OCR entry functions:
  - `ocrReceipt(uri)` (~L2271): `getRecognizer().recognize(uri)` →
    `classifyOcrText` → `runParse(text)`. Reached from **Take photo**
    (`captureReceipt`) and **Choose from library** (`pickReceipt`).
  - `scanStatement(uri)` (~L2489): `getRecognizer().recognizeLayout(uri)` →
    `reconstructLayout` → by `layout.kind`: `'unknown'` → "couldn't find any
    amounts" reply; `'receipt'` → `classifyOcrText(layout.text)` →
    `runParse` → `applyReceiptTotal`; else pre-cap → account choice →
    `beginStatementQueue`. Reached only from the third menu item **Scan
    statement** (`pickStatement`, library only).
- The user's first device attempt used *Choose from library* on a bank
  screenshot and got one transaction — the exact failure this spec removes.
- `layout.text` (`statementLayout.ts` L379: observations' text joined with
  `\n` in Vision order) is **byte-identical** to what `recognize()` returns
  (`AppleOcrModule.swift` L58-61: same request config, same order, same
  join). So the single-transaction parse sees the same input after the fold.
- `runParse` (~L760) guards `busy`, calls `resetActiveDraftState()` itself,
  and owns its own metrics row. `applyReceiptTotal` (`statementDrafts.ts`
  L397) is a pure override that only fires when `receiptTotal` is present.
- `MAX_STATEMENT_ROWS = 60` lives in `src/domain/statementDrafts.ts` L271.
- `app/debug-ocr.tsx` L56 still uses `recognize()` — the diagnostics screen,
  untouched by this spec.

## 3. Scope

1. Domain: a pure routing helper, `chooseScanRoute(layout)`, tested in Node.
2. Screen: one entry function `scanImage(uri)` replacing `ocrReceipt` and
   `scanStatement`; camera and library both call it; the **Scan statement**
   menu item and `pickStatement` are removed.
3. Copy that stopped being true ("that receipt", "your statement",
   "screenshot") is neutralised where the input could now be either.
4. Domain: `applyLayoutAmount(draft, layout)` — the single path takes its
   amount from the layout when the layout is unambiguous (receipt Total, or
   exactly one clean row), instead of trusting the text heuristic (added in
   the review fix round — reviewer B1).
5. Domain: OCR digit-for-letter normalisation on Total-family *labels* in
   `src/domain/statementLayout.ts`, so `T0TAL` / `G5T` still count as
   receipt signals (review fix round — reviewer B2).

Out of scope (recorded in §8): the receipt-gate sum check (statement-scan-spec
§9); any change to `reconstructLayout`'s geometry, `rowsToDrafts`,
`beginStatementQueue`'s queue mechanics, the account picker, or metrics.
The draft card gains one line of copy (`amountFromRow`) and nothing else.

## 4. Approach

### 4.1 Domain — `src/domain/statementDrafts.ts` (pure)

Add, next to `MAX_STATEMENT_ROWS` and `applyReceiptTotal`:

```ts
export type ScanRoute =
  | { kind: 'queue'; rowCount: number }    // ≥ 2 amount rows → account ask + one card per row
  | { kind: 'single' }                      // 0–1 rows, or a receipt → one transaction via the text parse
  | { kind: 'too_many'; rowCount: number }; // > maxRows → ask for two screenshots

export function chooseScanRoute(
  layout: Pick<StatementLayout, 'kind' | 'rows'>,
  maxRows: number = MAX_STATEMENT_ROWS
): ScanRoute
```

Rules, in order:
1. `layout.kind === 'receipt'` → `single`. A receipt is one purchase no matter
   how many item lines it has; its `rows` are `[]` by construction
   (statement-scan-spec §4.2 rule 6) but the helper must not rely on that.
2. `rowCount = layout.rows.filter((r) => r.value > 0).length` — the same
   filter `rowsToDrafts` applies, so a zero-value row never tips the decision.
3. `rowCount > maxRows` → `too_many`.
4. `rowCount >= 2` → `queue`.
5. otherwise → `single` (covers `kind: 'single'` and `kind: 'unknown'`).

`kind` is deliberately **not** used beyond rule 1: the routing question the
user asked for is "how many transactions are in this picture", and counting
rows keeps the answer honest if `kind`'s definition ever drifts.

**`applyLayoutAmount(draft, layout)`** — pure, applied to the pending draft
after `runParse` on the single path:

1. `layout.receiptTotal` → `applyReceiptTotal` (unchanged; sets
   `amountFromTotal`).
2. else if `layout.kind === 'single' && layout.unreadRows === 0 &&
   layout.rows.length === 1 && rows[0].value > 0` → the row is the source
   of truth, with the same semantics as the queue path's
   `buildDraftForRow` / `rowsToDrafts`:
   - amount = `toMinorUnits(rows[0].value, draft.currency)`,
     `amountFromRow: true` (presentation-only flag on `TransactionDraft`;
     card copy "Amount read straight from the photo.");
   - direction: `sign '+'` → `type: 'income'`, `'-'` → `'expense'`,
     `'?'` → the text parse's type stands; a `transfer` draft is never
     re-typed (QA Major 2 — a `PayNow … +S$50.00` credit has no
     `INCOME_RE` word, so the heuristic calls it an expense);
   - currency: `currencyConflict(row.currency, draft.currency)` →
     `mismatchedCurrency: row.currency` as well, so the card warns ("The
     photo shows "USD" — this account is in SGD…") and Save reroutes to
     Edit exactly as a queue row does (reviewer S1/S2).
   Date and payee are never touched.
3. otherwise the draft is returned untouched (same reference).

Why: the reviewer's repro — a DBS PayLah notification (`Card ending 4008` /
`FAIRPRICE FINEST  SGD 23.40`) reconstructs to one clean row of 23.40, but
the heuristic tier returns 4008.00 at confidence 0.9. The deleted "Scan
statement" path put that layout through the queue and got $23.40; routing
it to the text parse alone was a regression (§8 decision 4, reversed).

### 4.1b Domain — `src/domain/statementLayout.ts` (label normalisation)

`normaliseLabel(text)` = trim + lowercase + the classic OCR confusions
mapped back (`0→o`, `5→s`, `1→l`, `|→l`). It feeds **only** the
label-shaped regex tests: `TOTAL_FAMILY_RE` (block classification),
`BALANCE_VOCAB_RE`, `signalKindOf` and the `GRAND_TOTAL_RE` /
`TOTAL_RE` / `AMOUNT_DUE_RE` priority tests. Amount parsing, date
detection, descriptions, `headerText` and `text` are untouched.

Normalisation **can** make a merchant line match (`G5T ENTERPRISES` →
`gst enterprises` → `^gst\b`; QA Major, round 2), so a block is
classified in two tiers:
- **hard** — `TOTAL_FAMILY_RE` matches the raw trimmed text: exactly the
  pre-existing behaviour (never a row; signal; receiptTotal candidate).
- **soft** — matches only after normalisation: it contributes a signal and
  a receiptTotal candidate, but it does **not** `continue` — it falls
  through to the ordinary row / `unreadRows` path exactly as before
  normalisation existed, and it never advances `lastHardRowBlockIndex`.

The receipt gate becomes:
```
receiptSignal =
  hardKinds.size >= 2                                    // HEAD, untouched
  || (distinctSignalKinds.size >= 2 && footerShaped)     // soft evidence only when receipt-SHAPED
  || singleFamilyFooterReceipt                           // hard signals only
footerShaped = !dateLineSeen && every signal sits below the last HARD row
```
Soft evidence is weak: two mangled merchant names in a dated or interleaved
list (`G5T ENTERPRISES 88.00` … `T0TAL SPORTS 45.90` … `GRAB 12.50`)
must stay rows — with soft signals feeding the bare ≥ 2 gate they collapsed
a 4-row statement into a fake receipt with a fabricated total (reviewer,
round 3: 3,919 of 30,000 fuzzed layouts lost every row vs HEAD; 277 with
the shape rule, all of them undated lists made almost entirely of
total-family words — receipt-shaped by any honest reading).

Safety property, stated so it can fail: **if HEAD produced rows for an
input, the new code must not produce zero rows unless the input is
receipt-shaped** (undated, every signal under the last hard row). The
weaker "non-receipt outputs are byte-identical" invariant conditions on
the outcome and is satisfied vacuously by every failing case.

Why: with `TOTAL`→`T0TAL` and `GST in`→`G5T in` on the Stuff'd
fixture, the layout was `statement` with rows `[T0TAL 8.30, G5T in 0.69]`
→ route `queue` — a one-purchase receipt fanned out into two garbage cards.

### 4.2 Screen — `app/(tabs)/index.tsx`

**`scanImage(uri)`** replaces both `ocrReceipt` and `scanStatement`. Body is
today's `scanStatement` with the `kind` switch replaced by the route:

```
if (busy) return;
setBusy(true);
const startedAt = Date.now();                  // no reset here — an unreadable/empty/too-many photo leaves the current card alone
try {
  observations = await getRecognizer().recognizeLayout(uri)   // catch → "I couldn't read that photo — try a clearer shot."
  const layout = reconstructLayout(observations);
  statementScanLatencyRef.current = Date.now() - startedAt;
  const route = chooseScanRoute(layout);

  if (route.kind === 'too_many') {
    setReply(`That's ${route.rowCount} rows — I can take ${MAX_STATEMENT_ROWS} at a time. Try it in two shots.`);
    return;
  }
  if (route.kind === 'single') {
    // The single-transaction text path (statement-scan-spec §4.5 / QA MINOR 12):
    const outcome = classifyOcrText(layout.text);
    if (outcome.kind === 'empty') {
      setReply("I couldn't find any text in that photo — try a clearer shot.");
      return;
    }
    await runParse(outcome.text);                                   // runParse resets the active draft itself
    setPending((p) => (p ? applyLayoutAmount(p, layout) : p));        // §4.1: Total line, else the one clean row
    return;
  }
  // route.kind === 'queue'
  const activeAccounts = accounts.filter((a) => !a.archived);
  if (activeAccounts.length === 0) { setReply('Add an account first, then try that photo again.'); return; }
  resetActiveDraftState();                     // the queue owns the screen from here
  if (activeAccounts.length === 1) await beginStatementQueue(layout, activeAccounts[0]!);
  else setStatementAccountChoice(layout);
} catch { setReply("I couldn't read that photo — try a clearer shot."); }
finally { setBusy(false); }
```

Notes for the implementer:
- `recognize()` is **no longer called from this screen**. Keep it on the
  `TextRecognizer` interface (debug-ocr uses it).
- `'unknown'` no longer gets the statement-specific "couldn't find any
  amounts … full-screen screenshot" reply. It falls into `single`, where
  `classifyOcrText` + `runParse` do what the receipt path has always done
  for text without a parseable amount (the clarify ladder asks for it).
  That reply string is deleted.
- `resetActiveDraftState()` is **not** called up front (reviewer M1): an
  unreadable, empty or over-cap photo must not wipe the card the user is
  looking at, which is how the old receipt path behaved. The single path
  relies on `runParse`'s own reset; the queue path resets immediately
  before handing off to `beginStatementQueue` / the account picker.
- `beginStatementQueue` and `onChooseStatementAccount` /
  `onCancelStatementAccountChoice` are unchanged except the belt-and-braces
  cap message, which should read the same as the pre-cap one above.
- Rename `captureReceipt` → `capturePhoto`, `pickReceipt` → `pickPhoto`
  (both end in `await scanImage(uri)`); delete `pickStatement`.
- Camera-permission copy: `'I need camera access to take a photo.'`
- The `ContextMenu` `items` become exactly two: `Take photo` (camera icon →
  `capturePhoto`) and `Choose from library` (image icon → `pickPhoto`). Drop
  the "a statement is a screenshot, not a photo" comment with the item.
- Update the block comments that cite `scanStatement` / statement-scan-spec
  §4.4 (L504, L532, L719, L2484, L2990) to name `scanImage` and this spec.
- The account-picker title becomes `Which account is this from?` and the
  greeting ends "…or snap a receipt or statement." (reviewer m1/m2).
- `Found N rows — let's go through them.` stays.

### 4.3 Tests — `tests/__features__/scan-route.feature` + `tests/__steps__/scan-route.steps.ts`

Plain-Node BDD, same shape as `statement-drafts`. Fixtures come from
`tests/fixtures/statement/{bank1,ocbc,receipt}.observations.json` through
`reconstructLayout`; synthetic layouts are built as `StatementLayout`
literals (the helper takes `Pick<StatementLayout, 'kind' | 'rows'>`).

## 5. Acceptance criteria

Domain (`chooseScanRoute`):
1. bank1 → `{ kind: 'queue', rowCount: 6 }`; OCBC → `{ kind: 'queue', rowCount: 4 }`.
2. Receipt fixture → `{ kind: 'single' }`, and the same layout still has
   `receiptTotal.value === 8.3` (the override that makes the single card right).
3. A literal `{ kind: 'receipt', rows: [three rows with value > 0] }` → `single`
   (rule 1 wins over the count).
4. A one-row layout (`kind: 'single'`) → `single`; `reconstructLayout([])` →
   `single` (the text path then reports "no text").
5. Two rows where one has `value: 0` → `single`; two rows both `> 0` → `queue`.
6. Exactly `MAX_STATEMENT_ROWS` (60) rows → `queue` with `rowCount: 60`;
   61 → `{ kind: 'too_many', rowCount: 61 }`; `chooseScanRoute(layout, 3)`
   with 4 rows → `too_many` (the parameter is honoured).
7. The existing source-grep scenario (statement-scan-spec criterion 17) still
   passes unchanged — `chooseScanRoute` adds no model-calling identifier to
   `statementDrafts.ts` (and the label normalisation adds none to
   `statementLayout.ts`).

Domain (`applyLayoutAmount` — review fix round):
A1. PayLah repro end-to-end: observations → `reconstructLayout` → route
    `single` → `localParse(layout.text)` amount is the card-suffix decoy
    (pinned) → `applyLayoutAmount` → amount 2340, `amountFromRow === true`.
A2. Same layout with `unreadRows: 1` → draft unchanged (same reference).
A3. Row currency `USD` against an SGD draft → amount 2340,
    `amountFromRow`, and `mismatchedCurrency: 'USD'` (queue-path parity);
    `SGD` or `null` → no `mismatchedCurrency`.
A4. `receiptTotal` present alongside one row → the Total wins
    (`amountFromTotal`, no `amountFromRow`).
A5. `rows: []` → unchanged; one row with `value: 0` → unchanged.
A6. `PayNow Jane Tan +S$50.00` → `income`, 5000, `amountFromRow`;
    `Interest credited +S$12.34` → `income`, 1234; a `'-'` row against
    an income draft → `expense`; a `'?'` row leaves type alone; a
    `transfer` draft keeps `transfer`.

Domain (label normalisation — review fix round):
L1. Receipt fixture with `TOTAL`→`T0TAL`, `GST in`→`G5T in` →
    `kind: 'receipt'`, `receiptTotal.value === 8.3`, route `single`; also
    with `Subtot`→`5ubtot`.
L2. bank1, OCBC and the untouched receipt fixture produce exactly the same
    rows / kind / receiptTotal as before — no existing assertion changes.
L3. The pinned "labels and amounts removed" scenario names what it removes;
    "labels removed, amounts kept" is pinned at its measured values.
L4. A 3-row statement `Kopitiam 4.50 / G5T ENTERPRISES 12.50 / NTUC
    FairPrice 30.00` → 3 rows, `statement`, `unreadRows: 0`, route
    queue/3 (identical to HEAD); the same list undated with the soft-mangled
    merchant as the last row → still 3 rows (soft signals never feed the
    footer gate).
L6. Dated 4-row statement `FAIRPRICE FINEST 23.40 / G5T ENTERPRISES 88.00 /
    T0TAL SPORTS PTE LTD 45.90 / GRAB *TRIP 12.50` → `statement`, 4 rows,
    `receiptTotal null`, route queue/4; the same undated with the two soft
    merchants in the middle → 4 rows; with `AM0UNT DUE CORP` in place of
    `T0TAL SPORTS` → 4 rows. (Two soft families on a non-receipt-shaped
    layout are inert.)
L5. Receipt fixture with only `TOTAL`→`T0TAL` and the Subtotal/GST lines
    removed (sole signal is soft) → measured `unknown`, `rows: 0`,
    `unreadRows: 11`, route `single` — the T0TAL line stays merged in the
    same multi-amount price-column block as the item prices, so it is
    swallowed into `unreadRows` exactly like the labels-removed case (not,
    as first expected, a row of its own). Pinned as measured.

Screen (verified by grep + build, not by the BDD suite):
8. `/usr/bin/grep -nE "Scan statement|pickStatement|ocrReceipt|scanStatement|\.recognize\(" "app/(tabs)/index.tsx"` is empty (comments included — no stale references).
9. `/usr/bin/grep -c "recognizeLayout(" "app/(tabs)/index.tsx"` is `1`, and
   `/usr/bin/grep -n "label: '" "app/(tabs)/index.tsx"` shows exactly
   `'Take photo'` and `'Choose from library'` inside the scan `ContextMenu`.
10. `runParse`, `beginStatementQueue`, `rowsToDrafts`, `AccountPickerSheet`
    have no diff beyond the comment/copy changes named in §4.2; `DraftCard`
    gains only the `amountFromRow` line; `reconstructLayout` changes only
    through `normaliseLabel` (§4.1b).
11. `npm run typecheck`, `npm run lint`, `npm test` green (run via `npm run`,
    never bare jest/tsc/eslint — `rtk` masks failures).

Device (build 94, Beta direct install on Pigu — see memory
`beta-direct-install-flow`):
12. **Choose from library → OCBC screenshot** → account question (user has
    more than one account) → "Found 4 rows" → four cards with the amounts
    from statement-scan-spec criterion 2.
13. **Choose from library → Stuff'd receipt** → one card, amount S$8.30.
14. **Take photo** of a paper receipt → one card (amount from its Total line
    when Vision reads one).
15. **Take photo** of a bank statement shown on another screen, or a
    printed one → fans out into the queue (best-effort: skew may drop rows,
    but no row may pair the wrong merchant with an amount).
16. A picture with no text → "I couldn't find any text in that photo — try a
    clearer shot."; the attach menu shows two items only.
17. **Take photo** of a one-transaction bank notification (or a screenshot of
    one from the library) → one card with the printed amount, and the card
    says "Amount read straight from the photo."; a `+` credit shows as
    income.

## 6. Constraints

- Everything on-device; no model call anywhere in the layout or routing path
  (criterion 7). BYOK cloud parse is untouched and never auto-invoked.
- No native (`modules/apple-ocr`) or `ios/` change. **Never run `expo
  prebuild`**; `ios/` is hand-maintained.
- Domain logic stays framework-free (BDD suite runs in plain Node).
- Guardrail #6 unchanged: observations still cross `ocrObservationsSchema`
  in `appleVisionRecognizer.ts` before `reconstructLayout`.
- Commit only the named paths; no secrets; SSH remote; branch
  `claude/repeat-parity`.

## 7. Edge cases

- **Total line misread as `T0TAL` / `G5T`** — normalised back (§4.1b), so
  the receipt gate still fires and the card gets the Total. Pinned (L1).
- **Receipt with no TOTAL-family line at all.** Characterised by QA on the
  Stuff'd fixture with every Total/GST/Subtotal observation *and its amount
  token* removed: the item-price column stays one merged
  multi-amount block (columnar OCR: description-only and amount-only lines
  in the same block, so the self-contained split never fires — the
  unmodified fixture already reports `unreadRows: 8`), giving
  `kind: 'unknown'`, `rows: []`, route `single`. So it does **not** fan
  out; it goes through the plain text parse with no amount override — which
  is exactly what *Take photo* has always done with such a receipt. Not a
  regression, but the parse ladder is then guessing the amount from text
  that contains `S$0.00` / `S$2.00` item cells; the sum-of-magnitudes
  check (statement-scan-spec §9) is the proper fix and stays a follow-up.
  Pinned as a scenario so the behaviour is recorded. With only the `TOTAL`
  line surviving (Subtotal + GST gone) the layout is still `receipt` with
  `receiptTotal 8.3` (rule 6(b)), route `single`.
- **Receipt whose item lines are self-contained** (each line carries its
  own description and one price, and there is no Total-family line): the
  layout finds ≥ 2 rows and it fans out into per-item cards. Before this
  spec the user avoided that by picking "Take photo"; now the escape hatch
  is *Stop reviewing* / *Skip* on the queue. Accepted trade-off; the same
  sum check would rescue it.
- **One-row layout (`kind: 'single'`)**: the text parse builds the draft,
  then `applyLayoutAmount` takes amount, direction and currency claim from
  the row when the layout is unambiguous (`unreadRows === 0`, one positive
  row) — so a card suffix like `-4008` in the text no longer wins, and a
  `+` credit is income even without a "received"-type word. A layout with
  unread rows leaves the heuristic's answer alone; a foreign-currency row
  is flagged, never converted.
- **Merchant names that normalise into a label word** (`G5T ENTERPRISES`,
  `5UBTOTAL CAFE`): soft matches, so they stay rows unless the picture is
  a receipt by the ≥ 2-family gate — in which case rows are cleared anyway.
  Same for a digit-styled name the raw regex already matched (`GST
  ENTERPRISES`): pre-existing behaviour, unchanged.
- **Known limitation — undated list ending in two soft families.** The
  receipt-shape carve-out in §4.1b is load-bearing, and one realistic shape
  still lands inside it (reviewer, round 4): an undated statement whose last
  two rows are `G5T ENTERPRISES  S$88.00` and `T0TAL SPORTS PTE LTD
  S$45.90`, under clean rows, reads as a receipt — HEAD gave
  `statement / 4 rows`, this spec gives `receipt / 0 rows / receiptTotal
  45.90`, route single. Declared behaviour, not a contract violation: it
  needs two independent digit-confusions in two different families, both at
  the bottom, and no date line, and at that shape the geometry has no signal
  left to spend. Recorded so the next person meets it as a limitation, not
  a surprise; the sum-of-magnitudes check (statement-scan-spec §9) is the
  fix, which is where this whole family of cases converges.
- **Camera photos**: EXIF orientation is honoured by Vision (`AppleOcrModule`
  L41-44); perspective skew widens `medH` variance, so lines may cluster
  imperfectly — the honesty rule (drop, never mis-pair) still holds.
- **Cancelled picker**: nothing happens, `busy` never flips (it is set only
  once an image URI exists, as today).
- **Double tap**: `onScan`'s `busy` guard covers the menu; `scanImage`'s own
  guard covers the async gap.
- **Zero accounts + multi-row image**: `'Add an account first, then try that
  photo again.'`; a zero-account *single* image proceeds through `runParse`,
  which already handles the no-account case.
- **Layout parse metric**: recorded only on the queue path (`recordLayoutParse`
  in `beginStatementQueue`); the single path's metric row is `runParse`'s
  own — unchanged.

## 8. Decisions (taken 2026-09-03)

1. **Route by amount-row count, not by menu item** — user's call ("based on
   number of transactions system chooses"). Threshold: ≥ 2 rows → queue.
2. **`receipt` kind always single**, regardless of item rows.
3. **`unknown` falls back to the text parse** (today's receipt behaviour),
   not to a statement-flavoured refusal — a photo of an e-receipt with no
   parseable amount still gets asked for the amount.
4. **One-row layouts override the amount from the row when unambiguous**
   (reversed in the review fix round — B1). The original "keep the text
   parse byte-for-byte" call was a regression against the deleted Scan
   statement path, which got $23.40 where the heuristic picks 4008.00.
   Guard: `unreadRows === 0`, exactly one positive row. Direction follows
   the row's sign and a foreign currency is flagged, mirroring
   `rowsToDrafts` (QA Major 2 / reviewer S2, round 2).
5. **Menu shrinks to two items**; "Scan statement" and its library-only
   shortcut are gone.
6. **Mangled Total labels are normalised, not sum-checked** (B2), and a
   normalised-only ("soft") match is weak evidence: it never removes a row
   on its own (QA Major 1, round 2) and only tips the ≥ 2-family gate when
   the layout is already receipt-shaped — undated, totals under the rows
   (reviewer blocker, round 3). The sum-of-magnitudes check risks collapsing
   undated statements with equal-value rows and stays a follow-up.
7. **No up-front reset in `scanImage`** (M1): failures leave the current
   card alone, matching the old receipt path.

## 9. Follow-ups (not this spec)

- Receipt-gate sum check (statement-scan-spec §9) — would rescue the §7
  no-Total receipt and the self-contained-item-lines receipt.
- A balance-only screenshot ("Available balance SGD 1,204.55") is a
  one-row layout and now carries the "read straight from the photo" label —
  pre-existing on the queue path, unchanged here; belongs with the sum-check
  follow-up (reviewer observation).
- Review nits deliberately skipped: the redundant inner try/catch in
  `scanImage`, the `onScanReceipt` prop name on `QuickActionChips`, and
  the dead "Scan receipt" control in `AmountDisplay.tsx` (no caller).
- `.claude/commands/build.md` still describes the TestFlight flow; soak
  builds use the Beta direct install (memory `beta-direct-install-flow`).

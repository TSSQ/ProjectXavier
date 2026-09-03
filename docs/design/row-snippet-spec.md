# Row snippet — show the strip of the photo each card came from

Status: spec, 2026-09-03. Branch `claude/repeat-parity`, worktree
`.claude/worktrees/fm-spike`. Follows `docs/design/unified-scan-spec.md`
(build 94).

## 1. Objective

Every draft card produced from a photo shows a small strip of that photo —
the exact line(s) the numbers were read from — above the fields. It is the
visual half of the copy we already ship ("Amount read straight from the
photo.", "the receipt's TOTAL line"): the user can confirm the card against
the source without leaving the review flow.

Review-time only (decision D1). Nothing is written to the database, so
backups, SQLCipher and the ADR-0006 round-trip are untouched.

## 2. Verified starting state (build 94, commit `d27bd90`)

- Native Vision returns normalised, top-left-origin boxes per observation:
  `{text, x, y, w, h}`, each 0..1 — `src/domain/ocrObservation.ts:15-21`.
- `reconstructLayout` already carries per-line vertical extent internally:
  `RawLine.top/bottom` (`statementLayout.ts:223-228`) and
  `ProcessedLine.top/bottom` (`statementLayout.ts:237-243`).
- `LayoutRow` (`statementLayout.ts:15-34`) keeps only text/value/sign/
  currency — the geometry is discarded at the row boundary.
- **`rowsToDrafts` skips zero-value rows** (`statementDrafts.ts:420-426`),
  so `drafts[i]` is NOT `layout.rows[i]`. Any snippet keyed by queue index
  shows the wrong row's pixels. This is the central hazard of this spec.
- The queue renders one card at a time (`currentDraft`,
  `advanceQueueOrFinish`) — one decoded bitmap at a time.
- Both picker call sites already hold the asset's pixel `width`/`height`
  (`index.tsx:2360-2368`); `quality: 0.6` re-encodes but preserves
  dimensions.
- No image library is installed (`expo-image-manipulator`, `expo-image`
  both absent) and none is added by this spec.

## 3. Scope

1. `LayoutRow.band` and `receiptTotal.band` — normalised source rectangles.
2. `TransactionDraft.sourceBand` — carried on the draft **object**, set
   where the draft is built from its row, never by index.
3. A `RowSnippet` component that clips and translates a plain RN `Image`.
4. Wiring: the scanned image (uri + pixel dimensions) held in screen state
   for the life of the review, cleared with the rest of the draft state.

Out of scope: persisting snippets on saved transactions (D1); cropping to
a file; snippets for the `kind: 'unknown'` text-parse path (§7); zoom or
tap-to-expand; any change to routing, parsing or amount selection.

## 4. Approach

### 4.1 Domain — `src/domain/statementLayout.ts`

Add a shared type and a field:

```ts
/** Normalised (0..1, top-left origin) rectangle in the SAME coordinate
 *  space as OcrObservation — the union of the boxes of every observation
 *  that produced this row. Presentation only: nothing in reconstructLayout
 *  may branch on it (criterion 7). */
export interface SourceBand { x: number; y: number; w: number; h: number }
```

- `LayoutRow` gains `band: SourceBand` (the whole row) and
  `amountBand: SourceBand` (just the line carrying `amountText`). The
  second exists because the amount is what the user is verifying, so the
  renderer must be able to guarantee it stays on screen (§4.4a) — a
  guarantee the row band alone cannot give for a tall multi-line block.
- `StatementLayout.receiptTotal` becomes
  `{ value, text, band, amountBand } | null`, where `band` unions the
  TOTAL-label line with the amount line and `amountBand` is
  `unionBand([amountLine])` alone. Both are needed for the same reason
  `LayoutRow` needs both (QA round 2, D6): the union is NOT always tight —
  a receipt with footer copy, a QR block or a thank-you line between the
  TOTAL label and its printed value produces a tall union, and
  bottom-aligning to the union's bottom is not the same as bottom-aligning
  to the amount.
- `ProcessedLine` gains `left`/`right` alongside its existing `top`/
  `bottom`, taken from the min `x` / max `x + w` of the line's items.
- A row built from a block of several lines takes the **union** across
  those lines: `x = min(left)`, `y = min(top)`, `w = max(right) - x`,
  `h = max(bottom) - y`.

Additive only: `kind`, `rows` (all existing fields), `unreadRows`,
`headerText`, `text` and `receiptTotal.value/text` must be unchanged for
every fixture — the differential invariant the round-4 review established
still holds (criterion 6).

### 4.2 Domain — `src/domain/statementDrafts.ts` + `assistant.ts`

`TransactionDraft` gains `sourceBand?: SourceBand`, next to `amountFromRow`.
It is set in exactly the three places a draft learns its amount from a row:

1. `buildDraftForRow(row, ctx)` — `sourceBand: row.band` and
   `sourceAmountBand: row.amountBand`. Because this is
   the same call that builds the draft from that row, the correspondence
   cannot drift when `rowsToDrafts` drops a zero-value row. **No call site
   may index `layout.rows` to find a band.**
2. `applyReceiptTotal` — `sourceBand: layout.receiptTotal.band` and
   `sourceAmountBand: layout.receiptTotal.amountBand`, set alongside
   `amountFromTotal`. The two must never be set to the same rectangle
   here (D6).
3. `applyLayoutAmount`'s one-row branch — `sourceBand: row.band` and
   `sourceAmountBand: row.amountBand`, set alongside `amountFromRow`. The branches that return the draft unchanged
   (same reference) must keep returning the same reference.

### 4.3 Screen — `app/(tabs)/index.tsx`

- `scanImage` takes the picked asset, not a bare uri: `scanImage(asset)`
  where asset is `{uri, width, height}` from `assets[0]`. Both call sites
  (`index.tsx:2360-2368`) pass it through.
- New state `scanSource: { uri: string; width: number; height: number } |
  null`. **Set immediately after the `resetActiveDraftState()` that
  commits the screen to this scan — once in the `'single'` route after
  `runParse`, once in the `'queue'` route — never at the top of
  `scanImage`.** Setting it at the top looks tidier and is wrong: every
  early return (an unreadable photo, `too_many`, empty text, no accounts)
  would then leave the PREVIOUS card on screen paired with the NEW photo's
  strip — a confident strip of the wrong image. Cleared in
  `resetActiveDraftState()` and again in `advanceQueueOrFinish`'s
  queue-done branch, which is what makes D1's "disappears on save/skip"
  true of the state and not just the UI.
- `DraftCard` gains `sourceImage?: {uri, width, height} | null` and renders
  `<RowSnippet>` above the amount row **only when**
  `draft.sourceBand && draft.sourceAmountBand && sourceImage` — all three,
  since the bands are independent optionals today (see §9 follow-up 1).

### 4.4 Domain — `src/domain/snippetWindow.ts` (pure, new)

The window arithmetic is domain logic, not view code: it decides what the
user is shown of their own photo, and QA proved it can silently hide the
amount. It therefore lives in a framework-free module the plain-Node BDD
suite can test directly, and `RowSnippet` becomes a thin renderer over it.

```ts
export function computeSnippetWindow(input: {
  band: SourceBand;        // the whole row
  amountBand: SourceBand;  // the line carrying the amount
  containerWidth: number;  // px, from onLayout
  image: { width: number; height: number };  // pixel dims from the picker
  maxHeight: number;       // px cap on the strip
}): { dispW: number; dispH: number; translateX: number;
      translateY: number; height: number } | null
```

Returns `null` (render nothing) when `containerWidth <= 0`,
`image.width <= 0`, `image.height <= 0`, `band.w <= 0 || band.h <= 0`, or
the padded band is itself degenerate (`padded.w <= 0 || padded.h <= 0` —
reachable from `band.x === 1`).

Otherwise, in normalised units:

```
padded = band grown vertically by 0.15×band.h on EACH side, clamped to [0,1]
dispW  = containerWidth / padded.w
dispH  = dispW * (image.height / image.width)   // preserve pixel aspect
full   = padded.h * dispH                        // height if nothing clipped
```

- **Fits** (`full <= maxHeight`): show the whole band —
  `height = full`, `translateY = -padded.y * dispH`.
- **Too tall**: the visible window is `maxHeight` px and MUST contain the
  amount line. Bottom-align it to the amount: let
  `amountBottom = min(amountBand.y + amountBand.h + 0.15×band.h, 1)`;
  then `windowTop = clamp(amountBottom - maxHeight/dispH, padded.y,
  amountBand.y)` — the upper bound is the amount line's own top and
  nothing else (criterion 2c-i; using `amountBottom - amountBand.h` here
  smuggles in the ROW's padding and clips into the amount itself),
  `translateY = -windowTop * dispH`,
  `height = maxHeight`. This keeps the amount and as much of the
  description above it as fits — the reading order a card needs.

`translateX = -padded.x * dispW` in both cases.

### 4.4a Component — `src/components/ui/RowSnippet.tsx`

Calls `computeSnippetWindow` and renders the result: a `View` with
`overflow: 'hidden'` at the returned `height`, containing an `Image`
of `dispW`×`dispH` translated by the returned offsets. No arithmetic of
its own beyond reading `containerWidth` from `onLayout`, and it renders
nothing when the function returns `null`.

- Container: the card's existing corner radius and border token,
  `maxHeight` 96.
- Accessibility: the container carries
  `accessibilityLabel="The part of the photo this was read from"`; the
  `Image` is `accessible={false}` so VoiceOver reads one thing, not two.

## 5. Acceptance criteria

Domain (BDD suite, `tests/__features__/row-snippet.feature`):

1. bank1 fixture: every row has a band with `w > 0`, `h > 0` and
   `0 ≤ x, y, x+w, y+h ≤ 1`.
2. **Honesty (band)**: for every row of bank1 and ocbc, the band contains
   the box of the observation whose text is `row.amountText`, and
   `amountBand` contains that observation and is a subset of `band`
   (containment, not identity — the line may carry other glyphs).
2b. **Honesty (window)** — the criterion QA's Major proved was missing:
   for every row of bank1 and ocbc, at `containerWidth` 343 and image
   `1179×2556` (a real iPhone screenshot), the visible window returned by
   `computeSnippetWindow` contains the amount observation's y-range. All
   four ocbc rows exceed `maxHeight` and must still show their amount.
2c. `computeSnippetWindow` returns `null` for `containerWidth` 0,
   `image.width` 0, `image.height` 0, and a zero-area band.
2c-i. The clamp's upper bound is `amountBand.y` — the amount's own top —
   NOT `amountBottom - amountBand.h`. QA round 3 derived that the latter
   equals `amountBand.y + 0.15×band.h`, i.e. it carries the ROW's padding,
   which grows with the row's height and not the amount line's. That let
   the window start partway down into the amount's own line in two
   situations: at the genuine floor (`amountBand.h * dispH > maxHeight`),
   and — undocumented until round 3 — whenever
   `amountBand.h < maxHeight/dispH < amountBand.h + 0.15×band.h`, where
   the amount line alone would have fitted but the row's padding ate the
   budget. Test it: a row whose `band.h` is several multiples of
   `amountBand.h`, at containerWidth 400 / image 1179×2556, must show the
   amount's top edge exactly.
2c-ii. A band narrow enough that `amountBand.h * dispH` alone exceeds
   `maxHeight` still cannot show the whole amount — filling the container
   width from a narrow band blows up `dispH`. No fixture reaches this
   (narrowest real `band.w` is 0.798). Say so at the call site as a
   limitation, and never as a guarantee the function keeps.
2d. A row that fits (`full <= maxHeight`) is not repositioned: its
   `translateY` equals `-padded.y * dispH` and `height` equals `full`.
2e. **Honesty (receipt window)** — QA round 2's Major: a synthetic receipt
   whose TOTAL label and printed amount are separated by intervening
   footer lines, built so it survives `groupIntoBlocks` as one block and
   `reconstructLayout` still picks the right total, gives
   `receiptTotal.band.h` over the cap at containerWidth 343 / image
   1179×2556. The window must still contain the amount observation's
   y-range. This scenario must fail before the fix.
3. Multi-line row: a row whose description spans two lines has a band
   spanning both (`h` ≥ the taller line's `h`).
4. **Index-drift regression**: a layout whose middle row has `value: 0`
   (dropped by `rowsToDrafts`) — each resulting draft's `sourceBand`
   equals the band of the row it was built from, and specifically is NOT
   `layout.rows[draftIndex].band`.
5. receipt fixture: `receiptTotal.band` contains the observation box of the
   TOTAL line, and `applyReceiptTotal` copies it onto the draft.
6. **No behaviour change**: for bank1, ocbc and receipt, `kind`, `rows`
   (every pre-existing field), `unreadRows`, `headerText`, `text` and
   `receiptTotal.value/text` are identical to build 94's output.
7. `applyLayoutAmount`'s one-row branch sets `sourceBand`; its unchanged
   branches still return the same object reference.
7b. **Band linearity**: reconstructing a fixture whose observations are
   scaled 0.5× and shifted +0.1 yields bands that are the correspondingly
   scaled/shifted transform of the originals — not merely positive. QA
   found the existing invariance test only asserted `w > 0 && h > 0`, so
   a broken `unionBand` (absolute offset instead of proportional) would
   have passed.

Source greps (verified, not claimed):

8. `/usr/bin/grep -niE "band" src/domain/statementLayout.ts` — QA found
   the previous form matched 1 of 9 band lines and so verified almost
   nothing. Every hit must be a type declaration, a `unionBand(...)` call
   or a plain assignment; none may appear in an `if`, `?:` or comparison
   inside `reconstructLayout` (presentation-only guarantee). Paste the
   full output.
9. `/usr/bin/grep -n "rows\[" app src --include='*.tsx' --include='*.ts'`
   finds no index-based band lookup outside `statementLayout.ts` itself.
10. No new entry in `package.json` dependencies.

Gates: `npm run typecheck`, `npm run lint`, `npm test` all green; the
existing 1828 tests still pass unchanged.

## 6. Constraints

- Domain stays framework-free (plain Node BDD suite) — `SourceBand` is a
  plain interface, `RowSnippet` is the only file that imports from RN.
- Guardrail 5: nothing about the image leaves the device or reaches the
  database. The snippet is a transform over a URI the picker already gave
  us; no file is written.
- Guardrail 6: the band derives from `ocrObservationsSchema`-validated
  numbers, which zod already bounds to 0..1 — clamp anyway after padding.
- No `expo prebuild`, no `ios/` changes; this is JS-only.

## 7. Edge cases

- **`kind: 'unknown'` (text-parse path)**: no rows and no receipt total, so
  no band and no snippet — the card renders exactly as it does today. This
  is the receipt-with-no-TOTAL case from unified-scan-spec §7.
- **Skewed camera photo**: the band is the union of OCR boxes, so it tracks
  the text, but a rotated line yields a taller band that may clip a
  neighbour's ascenders. Cosmetic; the 0.3×h padding softens it.
- **Full-width band**: a statement row spanning the page gives `w ≈ 1`, so
  `dispW ≈ containerWidth` and the strip is simply the row at card width.
- **Very tall block**: the band exceeds `maxHeight`, so the window is
  bottom-aligned to the amount line (§4.4) and the top of the description
  is clipped instead. This is the common case, not an edge one: every row
  of the ocbc fixture is 137–164px at a realistic card width.
- **Picker returns no dimensions** (some HEIC/iCloud assets): render
  nothing rather than a distorted strip.
- **Receipt with a tall TOTAL block** (footer copy, QR or thank-you lines
  between the label and the printed value): the union band exceeds the cap,
  so the window bottom-aligns to `receiptTotal.amountBand` — same rule as
  a statement row (D6).
- **Editing a card**: the Edit sheet is unchanged; the snippet belongs to
  the review card only.

## 8. Decisions

- **D1 (user, 2026-09-03): review-only.** The snippet exists while the card
  is being decided and disappears on save/skip. Persisting it would put
  image bytes in SQLCipher, grow iCloud backups and force the ADR-0006
  round-trip test to cover binary payloads — a materially larger change for
  a benefit the review moment already delivers.
- **D2: band on the draft, never an index.** The zero-value-row drop makes
  index correspondence a live bug, not a hypothetical; criterion 4 pins it.
- **D3: clip-and-translate, not crop-to-file.** Same pixels, no new
  dependency, no async work, no temp files, no cleanup.
- **D4 (QA round 1): the window is anchored on the amount, not the top.**
  QA computed the real arithmetic against the ocbc fixture at 343px card
  width and 1179×2556 pixels: all four rows produce a 137–164px band, and
  with a top-anchored 96px clip the amount observation fell entirely
  outside the visible window on every one. A statement row's amount sits
  on its block's last line, so top-anchoring hides exactly what the user
  opened the card to check. Bottom-aligning the window to the amount keeps
  the number and as much description above it as fits.
- **D6 (QA round 2): the receipt total needs its own amount band.** The
  first implementation set the receipt draft's `sourceAmountBand` to the
  whole `receiptTotal.band`, reasoning that the union of the TOTAL label
  and the amount is always tight. QA disproved it with a valid synthetic
  receipt through the real pipeline: union height 0.204 → 232px at 343px
  card width, clipped to 96px, amount outside the window. Every path that
  can clip must carry an amount-line-only band; there are no "already
  tight" exemptions.
- **D5: the window maths lives in the domain, not the component.** It
  decides what the user is shown of their own photo and it demonstrably
  can hide the amount, so it belongs where the plain-Node suite can test
  it. The BDD suite excludes RN code, which is why this defect reached QA
  uncovered in the first place.

## 9. Follow-ups (not this spec)

1. **`SourceRegion { band, amountBand }` with a single constructor**
   `sourceRegion(blockLines, amountLine)`. Today the two are independent
   optionals on the draft, which is why `DraftCard` guards both halves and
   why QA round 2's Major (`sourceAmountBand := band`) was writable at all.
   One constructor makes `amountBand ⊆ band` true by construction and that
   defect unrepresentable. Deferred only because it touches types across
   three files; the boundary union in `computeSnippetWindow` buys most of
   the safety now.
2. **Clamp `padded.w` to a floor (≈0.3, centred)** to bound magnification.
   `dispW = containerWidth / padded.w` is unbounded below, so a
   right-aligned receipt whose TOTAL block spans ~0.15 of the width would
   render the photo at ~7× card width and push a short line past the cap.
   Real bands are 0.80–0.93, so this is defence, not a live bug — but it
   would make the 2c-ii floor unreachable in practice.
3. **Move `SourceBand` out of `statementLayout.ts`** into
   `ocrObservation.ts` or a small `geometry.ts`. It is generic geometry in
   the same space as `OcrObservation`, and `assistant.ts` — a general
   chat/scan draft type — should not have to import from the statement
   layout module to describe a rectangle.
4. **Horizontal padding on the strip.** `paddedBand` pads vertically only,
   so glyphs sit flush against the container border. Cosmetic.
5. Tap the snippet to see the whole photo.
6. Snippet for the `unknown` path via a coarse "amount-token
   neighbourhood" band, once the sum-of-magnitudes check lands.

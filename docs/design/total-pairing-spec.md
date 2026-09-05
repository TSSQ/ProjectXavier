# Pair a TOTAL label with the nearest amount, never the block's first

Status: spec, 2026-09-04. Branch `claude/repeat-parity`, worktree
`.claude/worktrees/fm-spike`. Bug found on build 96 by the user.

## 1. Objective

A photographed receipt showed `-SGD 8.90` captioned "Amount taken from the
receipt's TOTAL line" when the receipt's total was `31.05`. Pair a
total-family label with the amount actually printed next to it.

## 2. Reproduction (real, captured, in-repo)

`tests/fixtures/statement/skewed-receipt.observations.json` — a real
camera photo of a receipt, run through the app's exact Vision
configuration (`.accurate`, language correction, no orientation override,
boxes converted to top-left origin), then sanitised: staff name, address,
GST registration number, sales number, card suffix and merchant replaced
with placeholders of similar length. Geometry untouched — the geometry
IS the bug.

Today: `kind: 'receipt'`, `rows: 0`, `receiptTotal: { value: 8.9 }`.

Why. The photo is skewed, so the amount column sits ~0.012 higher than its
labels (`Total` y=0.690, `31.05` y=0.677; `Sub Total` y=0.626, `25.90`
y=0.613). Two consequences:

1. `Total`'s own line carries no amount, so `totalLine.amountParts[0]` is
   undefined.
2. The whole receipt grouped into ONE block, so the
   `?? blockAmount` fallback — the block's FIRST amount — returned `8.90`,
   the first line item on the bill.

The fallback is sound for what it was written for (an OCBC-style receipt
whose amount sits one line below its label). It is unsound when the block
is large: "first amount in the block" has no relationship to the label.

## 3. Scope

`statementLayout.ts`'s receipt-total selection only. Out of scope: block
grouping itself (the skew that merged the receipt is a deeper fix — see
§7), the per-item fan-out, the row path, anything in `snippetWindow.ts`.

## 4. Approach

Replace "the block's first amount" with **the amount whose line is
vertically nearest the total-family label**:

- If the label's own line carries an amount, use it (unchanged — this is
  the common case and every current fixture takes it).
- Otherwise pick the amount-bearing line in the block whose vertical
  centre is closest to the label line's vertical centre.
- **Proximity bound**: accept it only when that distance is within
  `NEAR_LINES × medH` of the label. Beyond that, pair nothing — set no
  receiptTotal. Choose the constant from the fixtures and justify it in a
  comment; the skewed fixture's real gap is ~0.7×medH, and the OCBC-style
  next-line case is ~1×medH, so a bound around 2.5–3 admits both with
  margin while still rejecting an amount half a receipt away.

Dropping rather than mis-pairing is the existing honesty rule
(statement-scan-spec criterion 4, and `unreadRows`' whole reason to
exist): a card with no amount asks the user; a card with a confidently
wrong amount does not.

`amountBand`/`band` continue to come from whichever line supplied the
amount, so the snippet keeps showing the evidence for the number claimed.

## 5. Acceptance criteria

1. The skewed fixture yields `receiptTotal.value === 31.05` (was 8.9), and
   `receiptTotal.text === '31.05'`.
2. Its `amountBand` contains the `31.05` observation, and the snippet
   window at containerWidth 343 / image 1179×2556 contains that
   observation's y-range.
3. The existing `receipt` fixture is **byte-identical** to build 96's
   output — value, text, band, amountBand, kind, rows, unreadRows,
   headerText, text. It pairs on the same line, so it must not move.
4. bank1 and ocbc: byte-identical to build 96 (they are not receipts).
5. A synthetic where the only other amount in the block is far from the
   label (beyond the bound) yields `receiptTotal: null` — dropped, not
   mis-paired — and the card then shows no "TOTAL line" caption.
6. A synthetic OCBC-style receipt (amount exactly one line below its
   label) still pairs correctly — the fallback's original purpose is
   preserved, pinned by its own scenario.
7. Ties (two amount lines equidistant) resolve deterministically; say
   which wins and why in a comment.
8. `npm run typecheck`, `npm run lint`, `npm test` green.

## 6. Constraints

- Domain stays framework-free.
- Additive-invariant discipline: this DOES change output for skewed
  receipts — that is the point — but it must change output for nothing
  else. Prove it by differential comparison against build 96 across the
  three pre-existing fixtures, and say what moved.
- The receipt gate went through four review rounds and a 150k-layout
  differential fuzz. Re-run an equivalent differential sweep; a change
  here is exactly where a regression would hide.

## 7. Follow-ups (not this spec)

1. **Block grouping under skew.** The real root cause is that a skewed
   photo merged the whole receipt into one block. Nearest-line pairing
   makes the total robust to that, but the fan-out path still sees one
   block; a deskew (estimate the column's baseline slope from the
   amount column and correct y before clustering) would fix the class.
2. **Sum check.** A receipt total should be ≥ every item amount in the
   block and, ideally, equal their sum plus tax lines. That would have
   caught 8.90 independently. Already recorded in statement-scan-spec §9.
3. Account matching read "VISA" off the receipt and offered it as an
   account ("VISA" not found — using OCBC 365). Payment-method words on
   a receipt are not account names; likely the same class of error as the
   intent gate reading receipt text as instructions (commit 8866ee5).

Feature: Row snippet — the strip of the photo each draft's amount was read from

  Every draft card produced from a photo shows the strip of that photo its
  numbers were read from (docs/design/row-snippet-spec.md). `LayoutRow.band`
  and `receiptTotal.band` are normalised (0..1, top-left origin) rectangles —
  the union of the OCR observation boxes that produced them — additive on
  `reconstructLayout`'s output. `LayoutRow.amountBand` is the band of just
  the line carrying the amount. `TransactionDraft.sourceBand`/
  `sourceAmountBand` ride on the draft OBJECT, set in exactly the three
  places a draft learns its amount from a row/receiptTotal
  (`buildDraftForRow`, `applyReceiptTotal`, `applyLayoutAmount`'s one-row
  branch) — never looked up by queue index, because `rowsToDrafts` drops
  zero-value rows, so `drafts[i]` is NOT `layout.rows[i]` (criterion 4 — the
  central hazard of this spec).

  `computeSnippetWindow` (src/domain/snippetWindow.ts) decides how much of
  the band the review card actually shows: the whole padded band when it
  fits within the strip's max height, or a max-height window bottom-aligned
  to the amount line when it doesn't (QA round 1, D4) — a top-anchored clip
  hid the amount entirely on every row of the real ocbc fixture.

  Scenario: bank1 — every row has a valid normalised band
    Given the "bank1" statement fixture reconstructed as a layout
    Then every row's band should have a positive width and height
    And every row's band should sit within the 0..1 normalised frame

  Scenario Outline: Honesty — a row's band and amountBand contain the observation that produced its amountText
    Given the "<fixture>" statement fixture reconstructed as a layout
    Then every row's band should contain the fixture observation matching its own amountText
    And every row's amountBand should contain the fixture observation matching its own amountText
    And every row's amountBand should be fully contained within its own band

    Examples:
      | fixture |
      | bank1   |
      | ocbc    |

  Scenario: OCBC row 1 — a multi-line row's band spans every line, not just the amount's own line
    Given the "ocbc" statement fixture reconstructed as a layout
    Then row 1's band height should be well beyond any single line's height in the fixture

  Scenario Outline: Window honesty — the visible strip always contains the amount, even when the band is too tall (QA round 1 Major)
    Given the "<fixture>" statement fixture reconstructed as a layout
    Then at containerWidth 343 and image 1179x2556, every row's snippet window should contain its amountBand's y-range

    Examples:
      | fixture |
      | bank1   |
      | ocbc    |

  Scenario: Window honesty's own premise — every ocbc row's band genuinely exceeds the strip's cap (reviewer nit 3)
    # bank1's rows all fit within maxHeight (57-61px at this width/image), so
    # the "Window honesty" outline above passes THAT Example through the
    # trivial (unclipped) branch — only ocbc actually exercises the clip
    # this feature exists to prove safe. Pinning that premise here means a
    # future MAX_HEIGHT or padding change that quietly stops exercising the
    # clip gets caught, instead of the outline silently passing for the
    # wrong reason.
    Given the "ocbc" statement fixture reconstructed as a layout
    Then every row's unclipped padded height in pixels at containerWidth 343 and image 1179x2556 should exceed 96

  Scenario Outline: computeSnippetWindow returns null for invalid input
    Given a snippet window request with containerWidth <containerWidth>, image <imageWidth>x<imageHeight>, and a band <bandDesc>
    When I compute the snippet window
    Then the snippet window should be null

    Examples:
      | containerWidth | imageWidth | imageHeight | bandDesc                 |
      | 0               | 1179       | 2556        | 0.10, 0.20, 0.30, 0.05   |
      | 343             | 0          | 2556        | 0.10, 0.20, 0.30, 0.05   |
      | 343             | 1179       | 0           | 0.10, 0.20, 0.30, 0.05   |
      | 343             | 1179       | 2556        | zero-width               |
      | 343             | 1179       | 2556        | zero-height              |

  Scenario: computeSnippetWindow leaves a fitting band unchanged
    Given a snippet window request with containerWidth 343, image 1179x2556, and a band 0.10, 0.40, 0.50, 0.02
    When I compute the snippet window
    Then the snippet window should not be null
    And the window's translateY should equal -padded.y × dispH
    And the window's height should equal the unclipped padded height

  Scenario: computeSnippetWindow never clips into the amount's own top edge, even with nominal room to spare (QA round 3 Minor)
    # QA round 3: the old `hi` clamp bound (amountBottom - amountBand.h)
    # equals amountBand.y + 0.15×band.h — it carries the ROW's padding, not
    # the amount line's, so the window could start partway down into the
    # amount whenever maxHeight/dispH < amountBand.h + 0.15×band.h, not only
    # at the genuine floor (amountBand.h * dispH > maxHeight). band.h here
    # is 4x amountBand.h (several multiples, per criterion 2c-i) so there is
    # nominal room for the amount line alone, yet the old bound still bit.
    Given a snippet window request with containerWidth 400, image 1179x2556, and a band 0.10, 0.29, 0.80, 0.28 with amount line at 0.30, 0.50, 0.20, 0.07
    When I compute the snippet window
    Then the snippet window should not be null
    And the window's visible top should equal the amount's own top exactly

  Scenario: receiptTotal with the TOTAL label and its amount on different lines — band spans both, amountBand is the amount alone (D6)
    Given a synthetic layout with these observations:
      | text     | x    | y    | w    | h    |
      | TOTAL    | 0.05 | 0.10 | 0.15 | 0.02 |
      | S$8.30   | 0.70 | 0.14 | 0.15 | 0.02 |
    When I reconstruct that synthetic layout
    Then the layout kind should be "receipt"
    And the receiptTotal band should contain the fixture observation "TOTAL"
    And the receiptTotal band should contain the fixture observation "S$8.30"
    And the receiptTotal band height should be well beyond a single line's height
    And the receiptTotal amountBand should equal the fixture observation "S$8.30"
    And the receiptTotal amountBand should not contain the fixture observation "TOTAL"
    And the receiptTotal band should contain its own amountBand

  Scenario: skewed-receipt fixture — nearest-line pairing keeps the total's snippet honest at real screen dimensions (total-pairing-spec.md criterion 2)
    Given the "skewed-receipt" statement fixture reconstructed as a layout
    Then the receiptTotal band should contain the fixture observation "31.05"
    And the receiptTotal band should contain its own amountBand
    And at containerWidth 343 and image 1179x2556, the receiptTotal's snippet window should contain the amount observation's y-range

  Scenario: Honesty (receipt window) — a tall TOTAL block with footer copy between the label and the amount still shows the amount (QA round 2 Major, D6)
    Given a synthetic receipt with SUBTOTAL well above TOTAL, and three footer lines between TOTAL and its printed amount
    Then the layout kind should be "receipt"
    And the receiptTotal value should be 50
    And the receiptTotal band height in pixels at containerWidth 343 and image 1179x2556 should exceed 96
    And the receiptTotal band should contain its own amountBand
    And at containerWidth 343 and image 1179x2556, the receiptTotal's snippet window should contain the amount observation's y-range

  Scenario: Index-drift regression — a dropped middle row must not leave a later draft with the wrong band
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    And row 4 of that layout has its value forced to 0
    When I build drafts from the layout
    Then there should be 5 drafts
    And each draft's sourceBand should equal the band of the row it was actually built from
    And draft 4's sourceBand should not equal the band of row 4 of the original layout

  Scenario: receipt fixture — receiptTotal.band contains the TOTAL line, and applyReceiptTotal copies it onto the draft
    Given the "receipt" statement fixture reconstructed as a layout
    Then the receiptTotal band should contain the fixture observation "TOTAL"
    And the receiptTotal band should contain its own amountBand
    And a plain expense draft for 1000 minor units in SGD
    When I apply the receipt total to that draft
    Then the applied draft's sourceBand should equal the layout's receiptTotal band
    And the applied draft's sourceAmountBand should equal the layout's receiptTotal amountBand

  Scenario Outline: Additive smoke check — kind, row count, unreadRows and headerText are undisturbed by band/amountBand
    # NOT the full "every pre-existing field is byte-identical" invariant
    # (reviewer nit 5) — that's `value`/`sign`/`description`/`amountText`/
    # `currency`/`text`/`receiptTotal.value`/`receiptTotal.text` too, and
    # it's already protected field-by-field by the 23 pre-existing
    # statement-layout.feature scenarios (unchanged by this spec) plus
    # `stripBands`'s exact-equality check in the scale/shift invariance
    # tests there. This scenario is a cheap spot check, from THIS feature's
    # own fixtures, that adding band/amountBand didn't flip a classification
    # decision — not a substitute for that suite.
    Given the "<fixture>" statement fixture reconstructed as a layout
    Then the layout kind should be "<kind>"
    And there should be <rowCount> rows
    And the unreadRows count should be <unreadRows>
    And the header text should contain "<headerSubstring>"

    Examples:
      | fixture | kind      | rowCount | unreadRows | headerSubstring   |
      | bank1   | statement | 6        | 0          | 25 Aug            |
      | ocbc    | statement | 4        | 0          | Today, 2 Sep 2026 |
      | receipt | receipt   | 0        | 8          | TOTAL             |

  Scenario: applyLayoutAmount's one-row branch sets sourceBand and sourceAmountBand
    Given a single-kind layout with 0 unread rows and a 23.40 SGD row banded at 0.10, 0.20, 0.30, 0.05
    And a plain expense draft for 1000 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft should be flagged amount-from-row
    And the applied draft's sourceBand should be 0.10, 0.20, 0.30, 0.05
    And the applied draft's sourceAmountBand should be 0.10, 0.20, 0.30, 0.05

  Scenario: applyLayoutAmount's receipt-total branch carries the receipt's own amount-line band, not the whole union (D6)
    Given a single-kind layout with a receiptTotal banded at 0.40, 0.50, 0.20, 0.03 with amount line at 0.42, 0.52, 0.10, 0.02, and a 23.40 SGD row
    And a plain expense draft for 1000 minor units in SGD
    When I apply the layout amount to that draft
    Then the applied draft's sourceBand should be 0.40, 0.50, 0.20, 0.03
    And the applied draft's sourceAmountBand should be 0.42, 0.52, 0.10, 0.02

  Scenario: applyLayoutAmount's unchanged branch returns the exact same draft reference and no sourceBand
    Given a single-kind layout with 1 unread row and a 23.40 SGD row banded at 0.10, 0.20, 0.30, 0.05
    And a plain expense draft for 1000 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft should be unchanged
    And the applied draft's sourceBand should be undefined
    And the applied draft's sourceAmountBand should be undefined

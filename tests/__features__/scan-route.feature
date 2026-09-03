Feature: Choosing the scan route from a layout

  chooseScanRoute decides what a scanned photo's layout becomes: a receipt
  or a 0-1 row layout stays one transaction ("single"); 2 or more amount
  rows fan out into the statement review queue ("queue"); more than
  `maxRows` amount rows asks for two screenshots ("too_many")
  (docs/design/unified-scan-spec.md §4.1/§5).

  Scenario: bank1 routes into the queue with 6 rows
    Given the "bank1" statement fixture reconstructed as a layout
    When I choose the scan route
    Then the route should be "queue" with rowCount 6

  Scenario: OCBC routes into the queue with 4 rows
    Given the "ocbc" statement fixture reconstructed as a layout
    When I choose the scan route
    Then the route should be "queue" with rowCount 4

  Scenario: The receipt fixture stays a single transaction, and its total survives
    Given the "receipt" statement fixture reconstructed as a layout
    When I choose the scan route
    Then the route should be "single"
    And the layout's receiptTotal value should be 8.3

  Scenario: A receipt-kind layout is always single, even with several rows (rule 1 wins over the count)
    Given a synthetic layout with kind "receipt" and these rows:
      | value | sign |
      | 5.50  | -    |
      | 3.80  | -    |
      | 9.30  | -    |
    When I choose the scan route
    Then the route should be "single"

  Scenario: A one-row layout stays single
    Given a synthetic layout with kind "single" and these rows:
      | value | sign |
      | 12.00 | -    |
    When I choose the scan route
    Then the route should be "single"

  Scenario: An empty layout (no observations at all) stays single
    Given the layout reconstructed from no observations
    When I choose the scan route
    Then the route should be "single"

  Scenario: Two rows tip the decision only when both are non-zero
    Given a synthetic layout with kind "statement" and these rows:
      | value | sign |
      | 0     | -    |
      | 5.00  | -    |
    When I choose the scan route
    Then the route should be "single"

  Scenario: Two non-zero rows route into the queue
    Given a synthetic layout with kind "statement" and these rows:
      | value | sign |
      | 4.00  | -    |
      | 5.00  | -    |
    When I choose the scan route
    Then the route should be "queue" with rowCount 2

  Scenario: Exactly the row cap still routes into the queue
    Given a synthetic layout with kind "statement" and 60 rows of value 10.00
    When I choose the scan route
    Then the route should be "queue" with rowCount 60

  Scenario: One row over the cap asks for two screenshots
    Given a synthetic layout with kind "statement" and 61 rows of value 10.00
    When I choose the scan route
    Then the route should be "too_many" with rowCount 61

  Scenario: A custom maxRows parameter is honoured
    Given a synthetic layout with kind "statement" and 4 rows of value 10.00
    When I choose the scan route with maxRows 3
    Then the route should be "too_many" with rowCount 4

  Scenario: Every Total-family LABEL and its own AMOUNT removed falls back to unknown, not receipt (QA M1)
    # Removes both halves of every total-family line — the label
    # observations (TOTAL, Subtot, GST in, the stray "<") AND their own
    # amount tokens (S$8.30, S$7.61, $$0.69) — from the receipt fixture; the
    # item price cells ("S$ 8.30" etc, WITH the space) stay untouched. With
    # no total-family signal left at all, kind falls through to "unknown"
    # and every amount-bearing line in the dropped multi-amount price
    # column counts toward unreadRows (statement-scan-spec.md §7, corrected).
    # Contrast with the two scenarios below this one: garbled-but-PRESENT
    # labels (review B2) still read as a receipt; labels removed but their
    # amounts left behind (QA's own measured variant) still can't recover
    # one, since there's no label left to anchor a total to.
    Given the "receipt" statement fixture reconstructed as a layout with these observations removed:
      | text   |
      | TOTAL  |
      | Subtot |
      | GST in |
      | <      |
      | S$8.30 |
      | S$7.61 |
      | $$0.69 |
    When I choose the scan route
    Then the layout kind should be "unknown"
    And the layout should have 0 rows
    And the layout's unreadRows should be 8
    And the layout should have no receiptTotal
    And the route should be "single"

  Scenario: Total-family labels removed but their amounts left behind still can't recover a total (QA measured)
    # QA's own repro: strip the label text only (TOTAL, Subtot, GST in, the
    # stray "<") and leave their amount tokens (S$8.30, S$7.61, $$0.69) in
    # place — there's no total-family LABEL left for reconstructLayout to
    # anchor a receipt total to, so all three amount lines fall into
    # unreadRows rather than becoming rows or a receiptTotal.
    Given the "receipt" statement fixture reconstructed as a layout with these observations removed:
      | text   |
      | TOTAL  |
      | Subtot |
      | GST in |
      | <      |
    When I choose the scan route
    Then the layout kind should be "unknown"
    And the layout's unreadRows should be 11
    And the route should be "single"

  Scenario: Only the TOTAL line surviving still reads as a receipt (QA M1 sibling)
    Given the "receipt" statement fixture reconstructed as a layout with these observations removed:
      | text   |
      | Subtot |
      | GST in |
      | S$7.61 |
      | $$0.69 |
    When I choose the scan route
    Then the layout kind should be "receipt"
    And the layout's receiptTotal value should be 8.3
    And the route should be "single"

  Scenario: OCR-mangled TOTAL and GST labels still read as a receipt (review B2)
    # "T0TAL"/"G5T in" are exactly what Vision's `.accurate` mode sometimes
    # returns for a low-contrast total line — normaliseLabel maps the digit
    # confusions back to letters before the total-family/signal regexes run,
    # so this stays a receipt exactly like the untouched fixture, instead of
    # fanning out into two garbage rows.
    Given the "receipt" statement fixture reconstructed as a layout with these observations relabelled:
      | from   | to     |
      | TOTAL  | T0TAL  |
      | GST in | G5T in |
    When I choose the scan route
    Then the layout kind should be "receipt"
    And the layout's receiptTotal value should be 8.3
    And the route should be "single"

  Scenario: All three OCR-mangled total-family labels still read as a receipt (review B2)
    Given the "receipt" statement fixture reconstructed as a layout with these observations relabelled:
      | from   | to     |
      | TOTAL  | T0TAL  |
      | GST in | G5T in |
      | Subtot | 5ubtot |
    When I choose the scan route
    Then the layout kind should be "receipt"
    And the layout's receiptTotal value should be 8.3
    And the route should be "single"

  Scenario: A merchant name that only LOOKS like a total label after normalisation stays a row (QA MAJOR 1)
    # "G5T ENTERPRISES" normalises to "gst enterprises", which matches the
    # total-family shape — but it never matched HEAD's own exact-text
    # TOTAL_FAMILY_RE, so it's only a SOFT signal. A lone soft signal never
    # drops a row on its own; this layout stays a 3-row statement exactly as
    # it would have before normaliseLabel existed.
    Given a layout reconstructed from these observations:
      | text            | x    | y    | w    | h    |
      | Kopitiam        | 0.05 | 0.10 | 0.30 | 0.02 |
      | 4.50            | 0.70 | 0.10 | 0.15 | 0.02 |
      | G5T ENTERPRISES | 0.05 | 0.30 | 0.30 | 0.02 |
      | S$ 12.50        | 0.70 | 0.30 | 0.20 | 0.02 |
      | NTUC FairPrice  | 0.05 | 0.50 | 0.30 | 0.02 |
      | 30.00           | 0.70 | 0.50 | 0.15 | 0.02 |
    When I choose the scan route
    Then the layout kind should be "statement"
    And the layout should have 3 rows
    And the layout's unreadRows should be 0
    And the route should be "queue" with rowCount 3

  Scenario: The soft-mangled merchant as the LAST row still isn't mistaken for a footer total (QA MAJOR 1)
    # Pins that a soft signal can't trigger the single-family-FOOTER receipt
    # gate either — that gate is HARD-signal-only.
    Given a layout reconstructed from these observations:
      | text            | x    | y    | w    | h    |
      | Kopitiam        | 0.05 | 0.10 | 0.30 | 0.02 |
      | 4.50            | 0.70 | 0.10 | 0.15 | 0.02 |
      | NTUC FairPrice  | 0.05 | 0.30 | 0.30 | 0.02 |
      | 30.00           | 0.70 | 0.30 | 0.15 | 0.02 |
      | G5T ENTERPRISES | 0.05 | 0.50 | 0.30 | 0.02 |
      | S$ 12.50        | 0.70 | 0.50 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout should have 3 rows
    And the route should be "queue" with rowCount 3

  Scenario: A receipt with only a soft-matched TOTAL label falls back to unknown, not receipt (QA MAJOR 1, measured)
    # QA's test (4): only "TOTAL" survives (mangled to "T0TAL"), Subtot and
    # GST in are gone entirely. Measured (not guessed): T0TAL is still
    # grouped into the SAME multi-amount price-column block as the item
    # prices, so it never gets its own single-amount block to become a row
    # OR a receiptTotal — it's swallowed into unreadRows exactly like the
    # "all labels removed" scenario above.
    Given the "receipt" statement fixture, with "Subtot" and "GST in" removed and "TOTAL" relabelled to "T0TAL", reconstructed as a layout
    When I choose the scan route
    Then the layout kind should be "unknown"
    And the layout should have 0 rows
    And the layout's unreadRows should be 11
    And the route should be "single"

  Scenario: A two-row layout built from real geometry keeps a zero-valued row out of the queue (QA m2)
    Given a layout reconstructed from these observations:
      | text     | x    | y    | w    | h    |
      | Kopitiam | 0.05 | 0.30 | 0.20 | 0.02 |
      | S$ 12.50 | 0.60 | 0.30 | 0.20 | 0.02 |
      | Refund   | 0.05 | 0.50 | 0.20 | 0.02 |
      | S$ 0.00  | 0.60 | 0.50 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout should have 2 rows
    And the route should be "single"

  Scenario: The same layout with both rows non-zero routes into the queue (QA m2)
    Given a layout reconstructed from these observations:
      | text     | x    | y    | w    | h    |
      | Kopitiam | 0.05 | 0.30 | 0.20 | 0.02 |
      | S$ 12.50 | 0.60 | 0.30 | 0.20 | 0.02 |
      | Refund   | 0.05 | 0.50 | 0.20 | 0.02 |
      | S$ 3.20  | 0.60 | 0.50 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout should have 2 rows
    And the route should be "queue" with rowCount 2

  Scenario: The layout's own amount overrides a text-parse decoy (B1 — PayLah notification repro)
    # A DBS PayLah notification: "Card ending 4008" sits right above the
    # real amount line. The heuristic text parse (localParse, the tier
    # runHeuristicParse falls back to) glues the card suffix onto the digits
    # after it and reports 400800 at high confidence — the layout itself
    # knows better, since it found exactly one fully-read row. This pins the
    # decoy BEFORE proving applyLayoutAmount corrects it.
    Given a layout reconstructed from these observations:
      | text             | x    | y    | w    | h    |
      | DBS PayLah!      | 0.05 | 0.10 | 0.30 | 0.02 |
      | Paid to          | 0.05 | 0.20 | 0.20 | 0.02 |
      | Card ending 4008 | 0.05 | 0.30 | 0.30 | 0.02 |
      | FAIRPRICE FINEST | 0.05 | 0.40 | 0.40 | 0.02 |
      | SGD 23.40        | 0.50 | 0.40 | 0.20 | 0.02 |
    When I choose the scan route
    Then the route should be "single"
    When the layout's text is parsed by the heuristic
    Then the heuristic amount should be 400800
    Given a plain expense draft in SGD seeded from that heuristic amount
    When I apply the layout amount to that draft
    Then the draft amount should be 2340
    And the draft should be flagged amount-from-row
    And the draft should have no mismatchedCurrency

  Scenario: An unread row alongside the single row blocks the override (B1 literal b)
    Given a single-kind layout with 1 unread row and a 23.40 SGD row
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft should be unchanged

  Scenario: A foreign-currency row still overrides the amount but flags mismatchedCurrency (reviewer S1/S2)
    Given a single-kind layout with 0 unread rows and a 23.40 USD row
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft amount should be 2340
    And the draft should be flagged amount-from-row
    And the draft's mismatchedCurrency should be "USD"

  Scenario: A same-currency row never flags mismatchedCurrency (reviewer S1/S2)
    Given a single-kind layout with 0 unread rows and a 23.40 SGD row
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft amount should be 2340
    And the draft should be flagged amount-from-row
    And the draft should have no mismatchedCurrency

  Scenario: A zero-value row never overrides the amount (reviewer S3)
    Given a single-kind layout with 0 unread rows and a 0.00 SGD row
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft should be unchanged

  Scenario: A receipt total always wins over a row amount (B1 literal d)
    Given a single-kind layout with a 8.30 receiptTotal and a 23.40 SGD row
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft amount should be 830
    And the draft should be flagged amount-from-total
    And the draft should not be flagged amount-from-row

  Scenario: An empty-rows layout leaves the draft amount alone (B1 literal e)
    Given a single-kind layout with no rows
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft should be unchanged

  Scenario: A '+' row forces income even when the text parse guessed expense (QA MAJOR 2 — PayNow)
    Given a single-kind layout with 0 unread rows and a 50.00 SGD row signed "+"
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft amount should be 5000
    And the draft type should be "income"
    And the draft should be flagged amount-from-row

  Scenario: A '+' row forces income (QA MAJOR 2 — Interest credited)
    Given a single-kind layout with 0 unread rows and a 12.34 SGD row signed "+"
    And a plain expense draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft amount should be 1234
    And the draft type should be "income"

  Scenario: A '-' row forces expense even when the text parse guessed income (QA MAJOR 2)
    Given a single-kind layout with 0 unread rows and a 23.40 SGD row
    And a plain income draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft type should be "expense"

  Scenario: A '?' row leaves the text parse's own type alone (QA MAJOR 2)
    Given a single-kind layout with 0 unread rows and a 23.40 SGD row signed "?"
    And a plain income draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft type should be "income"

  Scenario: A transfer draft keeps its type regardless of the row's sign (QA MAJOR 2)
    Given a single-kind layout with 0 unread rows and a 50.00 SGD row signed "+"
    And a plain transfer draft for 100 minor units in SGD
    When I apply the layout amount to that draft
    Then the draft type should be "transfer"
    And the draft amount should be 5000

  Scenario: Two SOFT signals never collapse a dated, interleaved statement into a receipt (BLOCKER — fuzzed 30k layouts, 3919 losses)
    # "G5T Enterprises" and "T0TAL Sports" each only LOOK like a total-family
    # label after normalisation (soft, review B2/QA MAJOR 1) — on their own
    # that's still >= 2 "distinct families" by the OLD gate, which collapsed
    # this real dated 4-row statement into a fabricated one-row receipt
    # stamped with S$45.90 "from the receipt's TOTAL line". A dated,
    # interleaved layout is never receipt-shaped, so soft evidence here must
    # stay inert.
    Given a layout reconstructed from these observations:
      | text                 | x    | y    | w    | h    |
      | 25 Aug 2026          | 0.05 | 0.05 | 0.40 | 0.02 |
      | FAIRPRICE FINEST     | 0.05 | 0.15 | 0.35 | 0.02 |
      | S$23.40              | 0.70 | 0.15 | 0.20 | 0.02 |
      | G5T ENTERPRISES      | 0.05 | 0.30 | 0.35 | 0.02 |
      | S$88.00              | 0.70 | 0.30 | 0.20 | 0.02 |
      | T0TAL SPORTS PTE LTD | 0.05 | 0.45 | 0.35 | 0.02 |
      | S$45.90              | 0.70 | 0.45 | 0.20 | 0.02 |
      | GRAB *TRIP           | 0.05 | 0.60 | 0.35 | 0.02 |
      | S$12.50              | 0.70 | 0.60 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout kind should be "statement"
    And the layout should have 4 rows
    And the layout should have no receiptTotal
    And the route should be "queue" with rowCount 4

  Scenario: The two soft merchants in the MIDDLE (a hard row after them) still don't collapse the list (BLOCKER sibling b)
    Given a layout reconstructed from these observations:
      | text                 | x    | y    | w    | h    |
      | G5T ENTERPRISES      | 0.05 | 0.10 | 0.35 | 0.02 |
      | S$88.00              | 0.70 | 0.10 | 0.20 | 0.02 |
      | T0TAL SPORTS PTE LTD | 0.05 | 0.25 | 0.35 | 0.02 |
      | S$45.90              | 0.70 | 0.25 | 0.20 | 0.02 |
      | FAIRPRICE FINEST     | 0.05 | 0.40 | 0.35 | 0.02 |
      | S$23.40              | 0.70 | 0.40 | 0.20 | 0.02 |
      | GRAB *TRIP           | 0.05 | 0.55 | 0.35 | 0.02 |
      | S$12.50              | 0.70 | 0.55 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout should have 4 rows
    And the route should be "queue" with rowCount 4

  Scenario: A soft "AM0UNT DUE" merchant alongside a soft GST merchant still doesn't collapse the list (BLOCKER sibling c)
    Given a layout reconstructed from these observations:
      | text             | x    | y    | w    | h    |
      | 25 Aug 2026      | 0.05 | 0.05 | 0.40 | 0.02 |
      | FAIRPRICE FINEST | 0.05 | 0.15 | 0.35 | 0.02 |
      | S$23.40          | 0.70 | 0.15 | 0.20 | 0.02 |
      | G5T ENTERPRISES  | 0.05 | 0.30 | 0.35 | 0.02 |
      | S$88.00          | 0.70 | 0.30 | 0.20 | 0.02 |
      | AM0UNT DUE CORP  | 0.05 | 0.45 | 0.35 | 0.02 |
      | S$45.90          | 0.70 | 0.45 | 0.20 | 0.02 |
      | GRAB *TRIP       | 0.05 | 0.60 | 0.35 | 0.02 |
      | S$12.50          | 0.70 | 0.60 | 0.20 | 0.02 |
    When I choose the scan route
    Then the layout should have 4 rows
    And the route should be "queue" with rowCount 4

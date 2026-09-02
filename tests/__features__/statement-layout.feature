Feature: Statement layout reconstruction (bank statement screenshot → rows)

  reconstructLayout turns raw OCR observations (text + normalised bounding
  box) into a StatementLayout — lines, then blocks, then rows — purely from
  geometry, no model in the loop (docs/design/statement-scan-spec.md §4.2).
  Every threshold is relative to the median observation height, so a zoomed
  or shifted screenshot reconstructs identically (criterion 5). Fixtures are
  the three sanitised, committed observation sets recorded by the 2026-09-02
  Mac probe (tests/fixtures/statement/*.observations.json).

  Scenario: bank1 — six rows, desktop-style list, amount on the same line as the description
    Given the "bank1" statement fixture
    When I reconstruct the layout
    Then the layout kind should be "statement"
    And there should be 6 rows
    And the row values should be 16.74, 3.2, 1.6, 1.8, 2.1, 5.2
    And every row sign should be "-"
    And every row dateText should be "25 Aug"
    And the unreadRows count should be 0
    And no row value should be 4008 or 9814
    # MAJOR 3 (QA): pairing must be asserted at the layout level, not only
    # via drafts — each row's UNCLEANED description still contains its
    # merchant string, in row order.
    And the row descriptions should contain, in order: "Kopitiam Investment", "NTUC FairPrice", "OLD TEA HUT", "OLD TEA HUT", "OLD TEA HUT", "COCONUT PIN"
    And every row currency should be null

  Scenario: OCBC — four rows, amount printed on its own line below the description
    Given the "ocbc" statement fixture
    When I reconstruct the layout
    Then the layout kind should be "statement"
    And there should be 4 rows
    And row 1 should be 1.5, "-", "Today, 2 Sep 2026"
    And row 2 should be 100, "-", "Today, 2 Sep 2026"
    And row 3 should be 1198.3, "+", "Today, 2 Sep 2026"
    And row 4 should be 482.45, "-", "Yesterday, 1 Sep 2026"
    And no row value should equal a reference number
    # MAJOR 3 (QA): the counterparty/reference text visible in the fixture,
    # in row order — row 1 has a nickname ("Alex"); rows 2-4 print only a
    # reference/description, which is what's asserted for them.
    And the row descriptions should contain, in order: "Alex", "PAYLAH! : 30741852", "ICT Other", "I-BANK Transfer"
    And every row currency should be "SGD"

  Scenario: A receipt classifies as receipt, not a statement, and is never split into rows
    Given the "receipt" statement fixture
    When I reconstruct the layout
    Then the layout kind should be "receipt"
    And there should be 0 rows
    And the receipt total value should be 8.3
    And the unreadRows count should be 8

  Scenario Outline: Honesty — every row's amount is one real observation, verbatim
    Given the "<fixture>" statement fixture
    When I reconstruct the layout
    Then every row's amountText should be the trimmed text of exactly one observation
    And every row's value should be the number printed in its amountText
    # reviewer MINOR 13: the receipt example's `rows` is [] (spec §4.2 step
    # 8 — a receipt is never split into rows), so the two assertions above
    # are vacuously true for it. This one is meaningful there instead: the
    # receipt's own `receiptTotal.text` must be a real observation's text,
    # verbatim — the same honesty check, just for the number that fixture
    # actually surfaces.
    And the receipt total, if present, should be the trimmed text of exactly one observation

    Examples:
      | fixture |
      | bank1   |
      | ocbc    |
      | receipt |

  Scenario: Scaling every box by 0.5 yields identical rows — thresholds are relative
    Given the "bank1" statement fixture
    And a copy of that fixture with every box scaled by 0.5
    When I reconstruct both layouts
    Then the rows should be identical

  Scenario: Shifting every box by +0.1 yields identical rows — thresholds are relative
    Given the "bank1" statement fixture
    And a copy of that fixture with every box shifted by 0.1
    When I reconstruct both layouts
    Then the rows should be identical

  Scenario: The joined text is the observations' own text, in input order
    Given the "ocbc" statement fixture
    When I reconstruct the layout
    Then the layout text should equal the fixture's observation text joined by newlines

  Scenario: A dual-currency line among uniformly-spaced rows is 1 unread row, not a lost row (QA MAJOR 1 / follow-up)
    # A dual-currency line ("Foreign Row USD 12.00 SGD 16.20") is itself
    # self-contained (>=1 amount + text), so splitSelfContainedBlocks still
    # splits this list one line per row — no "FX Note" continuation line is
    # needed to manufacture a gap jump any more. The dual-currency line's own
    # split-out single-line block then has 2 amount parts, so it becomes 1
    # unread row (not a row) instead of silently vanishing.
    Given a synthetic layout with these observations:
      | text        | x    | y    | w    | h    |
      | Foreign Row | 0.05 | 0.10 | 0.20 | 0.02 |
      | USD 12.00   | 0.55 | 0.10 | 0.15 | 0.02 |
      | SGD 16.20   | 0.75 | 0.10 | 0.15 | 0.02 |
      | Clean Row A | 0.05 | 0.14 | 0.20 | 0.02 |
      | -5.00       | 0.80 | 0.14 | 0.10 | 0.02 |
      | Clean Row B | 0.05 | 0.18 | 0.20 | 0.02 |
      | -6.00       | 0.80 | 0.18 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 2 rows
    And the row values should be 5, 6
    And the row descriptions should contain, in order: "Clean Row A", "Clean Row B"
    And the unreadRows count should be 1

  Scenario: A dual-currency MIDDLE row among uniform single-line rows is 1 unread row, flanked rows survive (QA follow-up item 2)
    Given a synthetic layout with these observations:
      | text       | x    | y    | w    | h    |
      | Row A desc | 0.05 | 0.10 | 0.20 | 0.02 |
      | -1.00      | 0.80 | 0.10 | 0.10 | 0.02 |
      | Row B desc | 0.05 | 0.14 | 0.20 | 0.02 |
      | USD 12.00  | 0.55 | 0.14 | 0.15 | 0.02 |
      | SGD 3.00   | 0.80 | 0.14 | 0.10 | 0.02 |
      | Row C desc | 0.05 | 0.18 | 0.20 | 0.02 |
      | -3.00      | 0.80 | 0.18 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 2 rows
    And the row values should be 1, 3
    And the row descriptions should contain, in order: "Row A desc", "Row C desc"
    And the unreadRows count should be 1

  Scenario: Uniformly-spaced single-line rows split one row per line, not a table (QA MAJOR 2a)
    Given a synthetic layout with these observations:
      | text       | x    | y    | w    | h    |
      | Row A desc | 0.05 | 0.10 | 0.20 | 0.02 |
      | -1.00      | 0.80 | 0.10 | 0.10 | 0.02 |
      | Row B desc | 0.05 | 0.14 | 0.20 | 0.02 |
      | -2.00      | 0.80 | 0.14 | 0.10 | 0.02 |
      | Row C desc | 0.05 | 0.18 | 0.20 | 0.02 |
      | -3.00      | 0.80 | 0.18 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 3 rows
    And the row values should be 1, 2, 3
    And the row descriptions should contain, in order: "Row A desc", "Row B desc", "Row C desc"
    And the unreadRows count should be 0

  Scenario: Uniformly-spaced amount-only/description-only lines with NO jump signal stay a table, counted per unread row (QA MAJOR 2b / M3 root cause)
    Given a synthetic layout with these observations:
      | text       | x    | y    | w    | h    |
      | Merchant A | 0.05 | 0.10 | 0.30 | 0.02 |
      | -1.00      | 0.80 | 0.14 | 0.10 | 0.02 |
      | Merchant B | 0.05 | 0.18 | 0.30 | 0.02 |
      | -2.00      | 0.80 | 0.22 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 0 rows
    And the unreadRows count should be 2

  Scenario: The same uniform gap, perturbed by floating-point noise, still stays one honest table (QA re-gate)
    # This is the exact failure QA hit: with a `medH` fallback threshold, some
    # of these ~equal gaps compared as `> medH` and others as `<= medH`,
    # splitting one block into partial pieces that paired an amount from one
    # line with a description from another. The fix (no jump signal → no
    # gap-based split at all, threshold = Infinity) must be immune to this.
    Given a synthetic layout with these observations:
      | text       | x    | y         | w    | h    |
      | Merchant A | 0.05 | 0.10      | 0.30 | 0.02 |
      | -1.00      | 0.80 | 0.1400001 | 0.10 | 0.02 |
      | Merchant B | 0.05 | 0.18      | 0.30 | 0.02 |
      | -2.00      | 0.80 | 0.2199999 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 0 rows
    And the unreadRows count should be 2

  Scenario Outline: A single two-line OCBC-style row is always one correct row, whatever its one gap happens to be
    # Only one gap exists in the whole layout, so no "jump" can ever be
    # computed (a jump needs two gaps to compare) — the fix makes this
    # unconditionally one block, whether that lone gap happens to be smaller
    # or larger than medH.
    Given a synthetic layout with these observations:
      | text        | x    | y           | w    | h    |
      | Merchant A  | 0.05 | 0.10        | 0.30 | 0.02 |
      | SGD - 1.50  | 0.80 | <amountY>   | 0.15 | 0.02 |
    When I reconstruct the layout
    Then there should be 1 rows
    And the row values should be 1.5
    And every row sign should be "-"
    And the row descriptions should contain, in order: "Merchant A"

    Examples:
      | amountY | note                  |
      | 0.135   | gap 0.015 < medH 0.02 |
      | 0.15    | gap 0.03 > medH 0.02  |

  Scenario: A weekday-prefixed date header is still recognised as a date line (MINOR 4, QA)
    Given a synthetic layout with these observations:
      | text                      | x    | y    | w    | h    |
      | Wednesday, 25 August 2026 | 0.05 | 0.05 | 0.40 | 0.02 |
      | Coffee Place              | 0.05 | 0.20 | 0.20 | 0.02 |
      | -4.50                     | 0.80 | 0.20 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 1 rows
    And every row dateText should be "Wednesday, 25 August 2026"

  Scenario: A single sub-pixel gap can't distort the threshold and glue an amount to the wrong description (reviewer B1)
    # The `> 0.5×medH` floor used to apply to one side of the ratio only, so
    # this near-zero gap between "-1.00" and "Merchant B" could stand as the
    # denominator, the ratio would explode, and the resulting threshold
    # collapsed to half the smallest REAL gap — splitting the list apart in
    # the wrong places (the buggy result: a row with value 1 but description
    # "Merchant B", plus two merchant-less rows). Filtered out of
    # consideration entirely, the remaining (uniform, no-jump) gaps mean the
    # whole list stays one honest table instead.
    Given a synthetic layout with these observations:
      | text       | x    | y      | w    | h    |
      | Merchant A | 0.05 | 0.10   | 0.30 | 0.02 |
      | -1.00      | 0.80 | 0.14   | 0.10 | 0.02 |
      | Merchant B | 0.05 | 0.1601 | 0.30 | 0.02 |
      | -2.00      | 0.80 | 0.2001 | 0.10 | 0.02 |
      | Merchant C | 0.05 | 0.2401 | 0.30 | 0.02 |
      | -3.00      | 0.80 | 0.2801 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 0 rows
    And the unreadRows count should be 3

  Scenario: A "Total balance" header above ordinary rows is not a receipt (reviewer B2a)
    Given a synthetic layout with these observations:
      | text          | x    | y    | w    | h    |
      | Total balance | 0.05 | 0.02 | 0.30 | 0.02 |
      | 12,480.55     | 0.70 | 0.02 | 0.20 | 0.02 |
      | 25 Aug        | 0.05 | 0.10 | 0.15 | 0.02 |
      | Coffee Place  | 0.05 | 0.20 | 0.20 | 0.02 |
      | -4.50         | 0.80 | 0.20 | 0.10 | 0.02 |
      | Grocery Store | 0.05 | 0.30 | 0.20 | 0.02 |
      | -30.00        | 0.80 | 0.30 | 0.10 | 0.02 |
      | Salary        | 0.05 | 0.40 | 0.20 | 0.02 |
      | +2000.00      | 0.80 | 0.40 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then the layout kind should be "statement"
    And there should be 3 rows
    And the row values should be 4.5, 30, 2000
    And the header text should contain "Total balance"

  Scenario: An "Amount due" header above ordinary rows is not a receipt (reviewer B2b)
    Given a synthetic layout with these observations:
      | text         | x    | y    | w    | h    |
      | Amount due   | 0.05 | 0.02 | 0.30 | 0.02 |
      | 500.00       | 0.70 | 0.02 | 0.20 | 0.02 |
      | Coffee Place | 0.05 | 0.20 | 0.20 | 0.02 |
      | -4.50        | 0.80 | 0.20 | 0.10 | 0.02 |
      | Grocery Store| 0.05 | 0.30 | 0.20 | 0.02 |
      | -30.00       | 0.80 | 0.30 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then the layout kind should be "statement"
    And there should be 2 rows

  Scenario: A single-item receipt with only a footer Total below it is still a receipt (reviewer B2c)
    Given a synthetic layout with these observations:
      | text   | x    | y    | w    | h    |
      | Coffee | 0.05 | 0.10 | 0.20 | 0.02 |
      | 4.50   | 0.80 | 0.10 | 0.10 | 0.02 |
      | Total  | 0.05 | 0.30 | 0.20 | 0.02 |
      | 4.50   | 0.80 | 0.30 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then the layout kind should be "receipt"
    And there should be 0 rows
    And the receipt total value should be 4.5

  Scenario: A dated transaction list with a footer Total is a statement, and the footer isn't a row (reviewer B2d)
    Given a synthetic layout with these observations:
      | text          | x    | y    | w    | h    |
      | 25 Aug        | 0.05 | 0.02 | 0.15 | 0.02 |
      | Coffee Place  | 0.05 | 0.20 | 0.20 | 0.02 |
      | -4.50         | 0.80 | 0.20 | 0.10 | 0.02 |
      | Grocery Store | 0.05 | 0.30 | 0.20 | 0.02 |
      | -30.00        | 0.80 | 0.30 | 0.10 | 0.02 |
      | Total         | 0.05 | 0.50 | 0.20 | 0.02 |
      | 1,234.56      | 0.70 | 0.50 | 0.20 | 0.02 |
    When I reconstruct the layout
    Then the layout kind should be "statement"
    And there should be 2 rows
    And the row values should be 4.5, 30

  Scenario Outline: A currency code that itself contains "CR"/"DR" doesn't fool the sign reader (reviewer MINOR 1)
    Given a synthetic layout with these observations:
      | text  | x    | y    | w    | h    |
      | Foo   | 0.05 | 0.10 | 0.20 | 0.02 |
      | <amt> | 0.80 | 0.10 | 0.15 | 0.02 |
    When I reconstruct the layout
    Then there should be 1 rows
    And every row sign should be "<sign>"

    Examples:
      | amt          | sign |
      | IDR 150.00   | ?    |
      | CRC 150.00   | ?    |
      | 100.00 CR    | +    |

  Scenario: A "2 Pending" line is not mistaken for a date, and doesn't split blocks (reviewer MINOR 2)
    Given a synthetic layout with these observations:
      | text         | x    | y    | w    | h    |
      | 2 Pending    | 0.05 | 0.02 | 0.20 | 0.02 |
      | 25 Aug       | 0.05 | 0.20 | 0.15 | 0.02 |
      | Coffee Place | 0.05 | 0.30 | 0.20 | 0.02 |
      | -4.50        | 0.80 | 0.30 | 0.10 | 0.02 |
    When I reconstruct the layout
    Then there should be 1 rows
    And every row dateText should be "25 Aug"
    And the header text should contain "2 Pending"

  Scenario Outline: A row's own currency is read from its amount token (reviewer B3)
    Given a synthetic layout with these observations:
      | text  | x    | y    | w    | h    |
      | Foo   | 0.05 | 0.10 | 0.30 | 0.02 |
      | <amt> | 0.80 | 0.10 | 0.15 | 0.02 |
    When I reconstruct the layout
    Then there should be 1 rows
    And every row currency should be <expected>

    Examples:
      | amt          | expected |
      | USD 12.99    | "USD"    |
      | SGD - 1.50   | "SGD"    |
      | S$ 8.30      | "SGD"    |
      | $ 5.00       | null     |

Feature: Statement rows become transaction drafts

  rowsToDrafts turns the rows `reconstructLayout` found into one
  TransactionDraft per row: amount/type from the row's sign, date from
  resolveStatementDate, a cleaned description reconciled against the user's
  own payee memory (never a keyword-to-category guess), a transfer hint when
  the raw text looks like one, and a likely-duplicate flag against the
  existing ledger (docs/design/statement-scan-spec.md §4.3). `now` is fixed
  at 2026-09-02T12:00 local, and the account currency is SGD throughout,
  matching the spec's acceptance criteria.

  Note on criterion 13 ("every draft passes the existing draft/transaction
  zod validation on save — saveAssistantDraft round-trips in the BDD DB
  harness for one bank1 draft"): no BDD DB harness for saveAssistantDraft
  exists in this suite (it goes through the Drizzle/expo-sqlite repository,
  which this plain-Node suite can't import). This feature instead proves the
  same trust boundary directly — every field `buildTransaction` derives from
  a bank1 draft passes `transactionSchema` (the exact schema
  `createTransaction` parses before every insert).

  Scenario: bank1 — six expense drafts with cleaned payees and the printed date
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And the payee "Kopitiam" with default category "Food"
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then there should be no dropped rows
    And there should be 6 drafts
    And every draft should be an expense
    And the draft amounts should be 1674, 320, 160, 180, 210, 520
    And every draft should occur on 2026-08-25
    And every draft's date should not be defaulted
    And the draft payee names should be "Kopitiam Investment", "NTUC FairPrice App", "OLD TEA HUT", "OLD TEA HUT", "OLD TEA HUT", "COCONUT PIN"
    And no draft payee name should contain "4008" or "9814" or "SINGAPORE" or "SG" or "("
    # findPayeeMatch alone can't suggest "Kopitiam" for "Kopitiam Investment"
    # (its ≥50%-length whole-word-variant guard rejects it) — that's what
    # findStatementPayeeMatch's prefix net is for (see its own scenarios
    # below). rowsToDrafts only ever ADOPTS an `exact` match, so draft 1's
    # payeeName stays "Kopitiam Investment" and its category stays unset
    # until the user taps "Use Kopitiam" on the card (which inherits the
    # payee's learned default category on save via resolveCategoryId).
    And draft 1's payee name should suggest the payee "Kopitiam"
    And draft 1's category should be null and defaulted

  Scenario: OCBC — four drafts, every one carrying a transfer hint
    Given the "ocbc" statement fixture reconstructed as a layout
    And the account "OCBC 360" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then there should be 4 drafts
    And the draft types should be "expense", "expense", "income", "expense"
    And the draft amounts should be 150, 10000, 119830, 48245
    And drafts 1 to 3 should occur on 2026-09-02
    And draft 4 should occur on 2026-09-01
    And every draft should carry a transfer hint
    And no draft payee name should contain a reference number or "ADV" or "ADVICE" or "OTHR" or "ICT" or "TRF"

  Scenario: OCBC — a matching PayLah account resolves the first two rows as transfers
    Given the "ocbc" statement fixture reconstructed as a layout
    And the account "OCBC 360" in SGD
    And another account "PayLah" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then draft 1 should be a transfer to "PayLah"
    And draft 2 should be a transfer to "PayLah"
    And draft 3 should not be a transfer
    And draft 4 should not be a transfer
    And draft 3 should still carry a transfer hint
    And draft 4 should still carry a transfer hint

  Scenario: A subtype-cue-only account match does not silently become a transfer (reviewer M1)
    # findAccountMatch resolves "CASH GIFT" against a cash-subtype account
    # via its subtype cue at confidence 0.7 — real enough to ANSWER "which
    # account?" in chat, but not to silently turn a row into a transfer and
    # throw the payee away. Only >= 0.85 (name-based match levels) clears the
    # bar here; criterion 9's PayLah match (0.85, token-containment) still
    # does — see the PayLah scenario above.
    Given a synthetic layout with these observations:
      | text                     | x    | y    | w    | h    |
      | PAYNOW TO JANE CASH GIFT | 0.05 | 0.10 | 0.60 | 0.02 |
      | -20.00                   | 0.85 | 0.10 | 0.10 | 0.02 |
    And the account "DBS" in SGD
    And another account "Rainy Day" (cash) in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then there should be 1 drafts
    And every draft should be an expense
    And every draft should carry a transfer hint
    And the draft payee names should be "PAYNOW TO JANE CASH GIFT"

  Scenario Outline: A row's own foreign currency flags the draft, never converts it (reviewer B3)
    Given a synthetic layout with these observations:
      | text  | x    | y    | w    | h    |
      | Foo   | 0.05 | 0.10 | 0.30 | 0.02 |
      | <amt> | 0.80 | 0.10 | 0.15 | 0.02 |
    And the account "DBS" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then draft 1's mismatchedCurrency should be <expected>

    Examples:
      | amt          | expected |
      | USD 12.99    | "USD"    |
      | SGD - 1.50   | undefined |
      | S$ 8.30      | undefined |
      | $ 5.00       | undefined |

  Scenario: OCBC drafts against an SGD account never flag mismatchedCurrency
    Given the "ocbc" statement fixture reconstructed as a layout
    And the account "OCBC 360" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then no draft should have a mismatchedCurrency

  Scenario Outline: Resolving a row's date text
    Given now is "<now>" local
    When I resolve the statement date "<dateText>"
    Then the resolved date should be "<expected>"
    And the date should <defaultedness> be defaulted

    Examples:
      | dateText                  | now              | expected   | defaultedness |
      | null                      | 2026-09-02T12:00 | 2026-09-02 | should        |
      # The roll-back itself is an assumption, not something read off the
      # page — the card should ask (reviewer MINOR 4). "25 Aug" printed on a
      # screenshot taken 2026-08-20 lands in the future in the CURRENT year,
      # so the roll-back fires here.
      | 25 Aug                    | 2026-08-20T12:00 | 2025-08-25 | should        |
      | Today, 2 Sep 2026         | 2026-09-09T15:00 | 2026-09-02 | should not    |
      | Today                     | 2026-09-09T15:00 | 2026-09-09 | should not    |
      | Wednesday, 25 August 2026 | 2026-09-02T12:00 | 2026-08-25 | should not    |
      # Reviewer MINOR 4's own pair: a roll-back fires for "5 Sep" (in the
      # future, current year, seen on 2 Sep) but not for "25 Aug" (already
      # in the past on the same "now").
      | 5 Sep                     | 2026-09-02T12:00 | 2025-09-05 | should        |
      | 25 Aug                    | 2026-09-02T12:00 | 2026-08-25 | should not    |

  Scenario: An exact payee match adopts the payee's name and default category
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And the payee "OLD TEA HUT" with default category "Food"
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then draft 3's payee should be "OLD TEA HUT" with category "Food", not defaulted

  Scenario: No payee match leaves the category unset — never guessed from a keyword
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then every draft's category should be null and defaulted

  Scenario Outline: findStatementPayeeMatch — a statement-only whole-word-prefix net on top of findPayeeMatch
    Given the payees "<payees>"
    When I find a statement payee match for "<name>"
    Then the match should be "<result>"

    Examples:
      | name                 | payees                    | result                          |
      | Kopitiam Investment  | Kopitiam                  | suggestion: Kopitiam             |
      | NTUC FairPrice App   | NTUC, NTUC FairPrice      | suggestion: NTUC FairPrice       |
      | OLD TEA HUT          | Old                       | no match                         |
      | Kopitiam Investment  | Kopitiam Investment       | exact: Kopitiam Investment       |
      | Starbuck             | Starbucks                 | suggestion: Starbucks            |

  Scenario: A same-amount, same-day, same-account transaction flags a likely duplicate
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    And an existing SGD 16.74 expense on 2026-08-25 in that account
    When I build drafts from the layout
    Then draft 1 should be flagged as a likely duplicate
    And there should still be 6 drafts

  Scenario: A different day does not flag a duplicate
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    And an existing SGD 16.74 expense on 2026-08-26 in that account
    When I build drafts from the layout
    Then draft 1 should not be flagged as a duplicate

  Scenario: The same amount as income does not flag a duplicate
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    And an existing SGD 16.74 income on 2026-08-25 in that account
    When I build drafts from the layout
    Then draft 1 should not be flagged as a duplicate

  Scenario: Every drafted transaction passes the persisted transaction schema
    Given the "bank1" statement fixture reconstructed as a layout
    And the account "SGD Wallet" in SGD
    And now is 2026-09-02T12:00 local
    When I build drafts from the layout
    Then every draft should pass the persisted transaction schema

  Scenario: applyReceiptTotal replaces the amount only when a total was found
    Given the "receipt" statement fixture reconstructed as a layout
    And a plain expense draft for 500 minor units in SGD
    When I apply the receipt total to that draft
    Then the draft amount should be 830
    And the draft should be flagged amount-from-total

  Scenario: applyReceiptTotal leaves the draft unchanged without a total
    Given a layout with no receipt total
    And a plain expense draft for 500 minor units in SGD
    When I apply the receipt total to that draft
    Then the draft amount should be 500
    And the draft should not be flagged amount-from-total

  Scenario: applyReceiptTotal leaves the draft unchanged when the only candidate is too far to pair (total-pairing-spec.md criterion 5)
    # Proves the screen actually degrades honestly, not just the domain
    # value: a Total label whose only other amount is 15×medH away
    # reconstructs with receiptTotal: null (dropped, not mis-paired), so the
    # card must never show "Amount taken from the receipt's TOTAL line"
    # (app/(tabs)/index.tsx's amountFromTotal caption) for it.
    Given a synthetic layout with these observations:
      | text  | x    | y    | w    | h    |
      | Total | 0.05 | 0.30 | 0.20 | 0.02 |
      | 60.00 | 0.80 | 0.60 | 0.15 | 0.02 |
    And a plain expense draft for 500 minor units in SGD
    When I apply the receipt total to that draft
    Then the draft amount should be 500
    And the draft should not be flagged amount-from-total

  Scenario: forgetUnmatchedAccount strips the scan path's unmatched-account warning (user report, build 97)
    # interpret() can set unmatchedAccountName from a card network or any
    # other stray printed word on a receipt ("VISA") that the user never
    # typed - genuinely useful on the chat path, pure noise on the scan
    # path, and it invites creating a phantom "VISA" account.
    Given a plain expense draft for 500 minor units in SGD with unmatched account name "VISA"
    When I forget the unmatched account on that draft
    Then the draft should not carry an unmatched account name

  Scenario: forgetUnmatchedAccount returns the exact same draft reference when there's nothing to forget
    Given a plain expense draft for 500 minor units in SGD
    When I forget the unmatched account on that draft
    Then the result should be the exact same draft reference

  Scenario: No model call anywhere in the statement domain
    Then neither statementLayout.ts nor statementDrafts.ts should call generateObject, deviceParse(), openaiParse or anthropicParse, nor import features/ai/deviceParse

  Scenario: The statement row cap is 60 (QA MINOR 7 — the screen checks this on the drafts array, not layout.rows)
    Then MAX_STATEMENT_ROWS should be 60

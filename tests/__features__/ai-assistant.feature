Feature: AI assistant expense flow
  A schema-validated AI parse is turned into a save, a clarifying question, or a
  block, and a confirmed draft becomes a valid transaction.

  Scenario: A confident, complete parse becomes a confirmable draft
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft amount should be 12.50 on account "Checking"

  Scenario: A missing amount asks a clarifying question
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense with no amount and confidence 0.9
    When the assistant interprets the parse
    Then it should ask a clarifying question about "amount"

  Scenario: Low confidence asks for more detail
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.2
    When the assistant interprets the parse
    Then it should ask a clarifying question

  Scenario: No account blocks with guidance
    Given there are no accounts
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    When the assistant interprets the parse
    Then it should be blocked

  Scenario: The assistant uses the account the AI named
    Given an asset account "Checking" with opening balance 100.00
    And an asset account "Amex" with opening balance 0.00
    And the AI parses an expense of 12.50 with type "expense" on account "Amex" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Amex"

  Scenario: An unrecognised account name falls back to the first account
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" on account "Nope" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Checking"

  Scenario: A confirmed draft builds a valid transaction
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    When the assistant interprets the parse
    And the draft is built into a transaction
    Then the transaction should pass validation
    And the transaction source should be "ai"

  Scenario: A sparse parse flags account, payee, category, and date as defaulted
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse has no account, payee, category, or date
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And every draft field should be marked as defaulted

  Scenario: A fully specified parse has no defaulted fields
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" on account "Checking" and confidence 0.9
    And the parse names a payee "Joe's Diner" and category "Dining"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And no draft field should be marked as defaulted

  Scenario: A named but unmatched account is flagged as defaulted
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" on account "Nope" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft account should be marked as defaulted
    And the unmatched account name should be "Nope"

  Scenario: The four defaulted flags are computed independently
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse names a payee "Joe's Diner"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft defaulted flags should be account true, payee false, category true, and date false

  Scenario: A date exactly 2 years old is still within the accepted window
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" occurring exactly 2 years ago and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft date should not be marked as defaulted

  Scenario: A date just over 2 years old falls outside the accepted window
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" occurring just over 2 years ago and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft date should be marked as defaulted

  Scenario: A transfer resolves the default account as source and the named account as destination
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And "OCBC 360" is the default account
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the user said "transfer 100 to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should transfer from "OCBC 360" to "Budget"
    And the draft payee and category should be null
    And the confirm message should be "Transferred $100.00 to Budget. Save it?"

  Scenario: "from X to Y" overrides the source account
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And an asset account "Savings" with opening balance 0.00
    And "OCBC 360" is the default account
    And the AI parses a transfer of 50.00 and confidence 0.9
    And the user said "transfer 50 from Savings to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should transfer from "Savings" to "Budget"

  Scenario: A transfer with no destination named asks the pinned clarifying question
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the user said "transfer 100 dollars"
    When the assistant interprets the parse
    Then it should ask a clarifying question
    And the clarifying message should be "Which account should I transfer to? (e.g. "transfer $100 from OCBC 360 to Budget")"

  Scenario: A transfer with only the destination account existing is blocked
    Given an asset account "Budget" with opening balance 50.00
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the user said "transfer 100 to Budget"
    When the assistant interprets the parse
    Then it should be blocked
    And the block message should be "You'll need a second account to transfer between."

  Scenario: The transfer source can never resolve to the same account as the destination
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the user said "transfer 100 from Budget to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft transfer source and destination should be different accounts

  Scenario: A transfer's draft amount is a positive magnitude
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And the AI parses a transfer of 75.00 and confidence 0.9
    And the user said "transfer 75 to Budget"
    When the assistant interprets the parse
    Then the draft amount should be positive

  Scenario: A pending-flagged parse pre-sets the draft's pending flag
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse is flagged pending
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should be pending

  Scenario: A parse with no pending flag leaves the draft not pending
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should not be pending

  Scenario: A confirmed pending draft builds a transaction that starts pending
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse is flagged pending
    When the assistant interprets the parse
    And the draft is built into a transaction
    Then the transaction should pass validation
    And the transaction should be pending

  Scenario: A pending-flagged transfer parse pre-sets the draft's pending flag
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And "OCBC 360" is the default account
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the parse is flagged pending
    And the user said "transfer 100 to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should be pending

  # ─── Currency conflict (a live money bug: foreign-currency amounts corrupt
  # balances — see domain/currencyConflict.ts) ───────────────────────────────
  # The app never converts currency (CLAUDE.md #3 — ask, never convert): a
  # parsed currency that conflicts with the destination account's own is
  # never stored — the account's currency always wins, and the draft is
  # flagged instead so the confirm card can require the user to re-enter the
  # amount themselves.

  Scenario: A parsed currency that conflicts with the account's is never stored as-is
    Given an asset account "Checking" with opening balance 100.00 and currency "SGD"
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse names currency "USD"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft currency should be "SGD"
    And the draft mismatched currency should be "USD"

  Scenario: A same-currency parse leaves the draft currency and mismatch flag unaffected
    Given an asset account "Checking" with opening balance 100.00 and currency "SGD"
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    And the parse names currency "SGD"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft currency should be "SGD"
    And the draft should have no mismatched currency

  Scenario: A transfer's parsed currency that conflicts with the source account's is never stored as-is
    Given an asset account "OCBC 360" with opening balance 100.00 and currency "SGD"
    And an asset account "Budget" with opening balance 50.00
    And "OCBC 360" is the default account
    And the AI parses a transfer of 100.00 and confidence 0.9
    And the parse names currency "USD"
    And the user said "transfer 100 to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft currency should be "SGD"
    And the draft mismatched currency should be "USD"

  # ─── Named-account resolution via findAccountMatch (a live matching bug —
  # see docs/design/account-match-assistant-spec.md) ─────────────────────────
  # `interpret`/`interpretTransfer` used to resolve the AI's named account with
  # raw case-insensitive equality, so anything but a near-verbatim echo of the
  # account's name failed to match. Both now resolve through the same
  # deterministic `findAccountMatch` the query/statement paths already use.
  # Confidence is gated by construction: `findAccountMatch` only ever
  # populates `account` from its exact/containment/subtype-cue tiers, never
  # from the fuzzy tier (a `suggestion` only) and never when 2+ accounts tie
  # (`ambiguous`) — so a fuzzy guess can never silently win.

  Scenario Outline: A loosely phrased account name still resolves confidently
    Given an asset account "Singapore Pools Wallet" with opening balance 0.00
    And an asset account "OCBC 365" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "<spoken>" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Singapore Pools Wallet"
    And the draft account should not be marked as defaulted

    Examples:
      | spoken                   |
      | Singapore Pools          |
      | singapore pools          |
      | Singapore  Pools  Wallet |
      | Singapore Pools wallet.  |
      | pools wallet             |

  Scenario: A spoken account name with leading/trailing whitespace still resolves confidently
    Given an asset account "Singapore Pools Wallet" with opening balance 0.00
    And an asset account "OCBC 365" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account " singapore pools wallet " and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Singapore Pools Wallet"
    And the draft account should not be marked as defaulted
    And the draft should not flag the account match as inferred

  Scenario Outline: A pure letter-case variant resolves exactly as it did before this change
    Given an asset account "Singapore Pools Wallet" with opening balance 0.00
    And an asset account "OCBC 365" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "<spoken>" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Singapore Pools Wallet"
    And the draft account should not be marked as defaulted
    And the draft should not flag the account match as inferred

    Examples:
      | spoken                 |
      | singapore pools wallet |
      | SINGAPORE POOLS WALLET |
      | Singapore pools WALLET |

  Scenario: An account name matching nothing keeps today's behaviour with two accounts present
    Given an asset account "Singapore Pools Wallet" with opening balance 0.00
    And an asset account "OCBC 365" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "Amazon Prime" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Singapore Pools Wallet"
    And the draft account should be marked as defaulted
    And the unmatched account name should be "Amazon Prime"

  Scenario: A subtype cue matching two accounts is never silently resolved
    Given an asset account "Cash Wallet" with subtype "cash" and opening balance 0.00
    And an asset account "Travel Wallet" with subtype "cash" and opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "the wallet" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Cash Wallet"
    And the draft account should be marked as defaulted
    And the draft should have no unmatched account name
    And the draft should surface an account ambiguity between "Cash Wallet" and "Travel Wallet"

  Scenario: An archived account is never matched even against its own exact name
    Given an asset account "Singapore Pools Wallet" with opening balance 0.00
    And an asset account "OCBC 365" with opening balance 0.00
    And the account "Singapore Pools Wallet" is archived
    And the AI parses an expense of 20.00 with type "expense" on account "Singapore Pools Wallet" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "OCBC 365"
    And the unmatched account name should be "Singapore Pools Wallet"

  Scenario: A transfer's loosely phrased named source still resolves
    Given an asset account "Singapore Pools Wallet" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And the AI parses a transfer of 20.00 and confidence 0.9 on account "pools wallet"
    And the user said "transfer 20 to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should transfer from "Singapore Pools Wallet" to "Budget"
    And the draft account should not be marked as defaulted

  Scenario: A transfer whose loosely named account equals the destination still falls through as today
    Given an asset account "OCBC 360" with opening balance 100.00
    And an asset account "Budget" with opening balance 50.00
    And "OCBC 360" is the default account
    And the AI parses a transfer of 20.00 and confidence 0.9 on account "the budget"
    And the user said "transfer 20 to Budget"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should transfer from "OCBC 360" to "Budget"

  Scenario: A loosely matched account is flagged as inferred, not silently trusted
    Given an asset account "OCBC 365" with opening balance 0.00
    And an asset account "Kopi Restaurant Account" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "restaurant" and confidence 0.9
    And the parse names a payee "Kopi Restaurant"
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "Kopi Restaurant Account"
    And the draft account should not be marked as defaulted
    And the draft should flag the account match as inferred from "restaurant"

  Scenario: A fuzzy near-miss typo is never auto-picked
    Given an asset account "OCBC 365" with opening balance 0.00
    And an asset account "OCBC 360" with opening balance 0.00
    And the AI parses an expense of 20.00 with type "expense" on account "OCBC 36" and confidence 0.9
    When the assistant interprets the parse
    Then it should offer a draft to confirm
    And the draft should use account "OCBC 365"
    And the draft account should be marked as defaulted
    And the unmatched account name should be "OCBC 36"
    And the draft should not flag the account match as inferred

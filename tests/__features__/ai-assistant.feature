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

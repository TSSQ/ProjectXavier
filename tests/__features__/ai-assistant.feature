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

  Scenario: A confirmed draft builds a valid transaction
    Given an asset account "Checking" with opening balance 100.00
    And the AI parses an expense of 12.50 with type "expense" and confidence 0.9
    When the assistant interprets the parse
    And the draft is built into a transaction
    Then the transaction should pass validation
    And the transaction source should be "ai"

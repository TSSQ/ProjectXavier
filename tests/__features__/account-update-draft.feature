Feature: Account update draft assembly — deterministic op classification, balance safety
  buildAccountUpdateDraft/classifyAccountUpdateOp (docs/design/account-chat-
  crud-spec.md §5.2/§6.2) classify the specific sub-operation (rename/retype/
  rebalance) by verb-pattern FIRST — the model's own operation is only a
  tiebreak.

  BALANCE SAFETY (QA blocker): `parseOpeningBalance` strips every non-digit
  from the WHOLE utterance — a rename/retype must NEVER let that clobber the
  real balance. Only a REBALANCE op ever parses a new balance from the text;
  every other op carries the account's EXISTING balance through unchanged.

  Background:
    Given an existing account "DBS Savings" of subtype "bank" with balance 10000

  Scenario Outline: Deterministic verb-pattern classifies the operation without any model help
    When I build an account update draft for "<text>" with no extraction
    Then the draft operation should be "<op>"

    Examples:
      | text                                    | op        |
      | rename my DBS Savings to Rainy Day       | rename    |
      | rebalance my DBS Savings                 | rebalance |
      | update my DBS Savings opening balance    | rebalance |
      | change my DBS Savings to a credit card   | retype    |
      | change my DBS Savings name                | rename    |

  Scenario: The model's operation is used only when the deterministic classifier can't tell
    When I build an account update draft for "please adjust DBS Savings" with extraction operation "rename" newName "" newSubtype ""
    Then the draft operation should be "rename"

  Scenario Outline: A rename/retype draft's balance is ALWAYS the account's existing balance, never parsed from the text
    When I build an account update draft for "<text>" with no extraction
    Then the draft newBalance should be 10000
    And the draft balanceEdited should be false

    Examples:
      | text                                              |
      | rename my DBS Savings to Rainy Day                 |
      | rename my Amex ending 1234 to Travel Amex          |
      | change my DBS Savings to a credit card             |

  Scenario: A rebalance draft's balance IS parsed from the text, and marked edited
    When I build an account update draft for "set DBS Savings balance to 5000" with no extraction
    Then the draft newBalance should be 500000
    And the draft balanceEdited should be true

  Scenario: An extraction's new name is used verbatim when present; otherwise the account's current name is kept
    When I build an account update draft for "rename my DBS Savings to Rainy Day" with extraction operation "rename" newName "Rainy Day" newSubtype ""
    Then the draft newName should be "Rainy Day"
    When I build an account update draft for "rebalance my DBS Savings" with no extraction
    Then the draft newName should be "DBS Savings"

  Scenario: An unclassifiable op with no model help yields 'unknown', which the chat flow turns into a clarify question, not a no-op card (QA MINOR follow-up)
    When I build an account update draft for "please adjust DBS Savings" with no extraction
    Then the draft operation should be "unknown"
    And the clarify message for "DBS Savings" should mention "DBS Savings"

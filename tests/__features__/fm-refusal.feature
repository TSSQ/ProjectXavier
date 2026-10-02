Feature: An on-device FM refusal is not a failure, and is never silently logged
  When Foundation Models answers `isTransaction: false` (its "not a transaction"
  verdict, the first field it fills), the app says so and offers "Log anyway"
  instead of falling back to the heuristic. A real failure still falls back.

  Scenario: A refusal is distinguished from a failure and the heuristic is not consulted
    Given the model refuses "should I pay $50 for dinner?"
    When the on-device attempts run
    Then the outcome is refused
    And the heuristic was not consulted

  Scenario: An invalid or thrown result is a failure, not a refusal
    Given every attempt fails
    When the on-device attempts run
    Then the outcome is failed

  Scenario: A usable parse is accepted
    Given the model parses "coffee 4.80" as 480
    When the on-device attempts run
    Then the outcome is parsed with amount 480

  Scenario: A parsed outcome does not carry the verdict
    Given the model parses "coffee 4.80" as 480
    When the on-device attempts run
    Then the parsed expense has no isTransaction key

  Scenario: A refusal on one attempt and a throw on the next stays a refusal
    Given the model refuses "I owe Sam 20" then the next attempt throws
    When the on-device attempts run
    Then the outcome is refused

  Scenario: Log anyway runs the heuristic on the refused text
    Given the refused text "paid 20 for dinner"
    When I tap Log anyway
    Then the heuristic draft has amount 2000

  Scenario: Log anyway on text with nothing loggable yields no amount
    Given the refused text "should I buy a car"
    When I tap Log anyway
    Then the heuristic draft has no amount

  Scenario: A refused model output never carries a zero or empty-string field
    Given a refusal output with amount 0 and every text field empty
    When the output is normalized
    Then amount category payee account and note are all null
    And the parse is not useful

  Scenario: isTransaction false removes the amount even when the model gave one
    Given a refusal output that still has amount 50
    When the output is normalized
    Then the amount is null and the verdict is false

  Scenario: Output without a verdict (the shared BYOK contract) normalizes exactly as before
    Given a shared-contract output with amount 12.5 and no isTransaction
    When the output is normalized
    Then the amount is 1250 and the result has no isTransaction key

  Scenario: A transaction with no amount in text with no digits is a failure so the heuristic asks how much
    Given the model says transaction with no amount for "lunch at Chipotle"
    When the on-device attempts run
    Then the outcome is failed

  Scenario: A transaction with a date but no amount is a failure so the heuristic asks how much
    Given the model says transaction with no amount for "lunch at Chipotle on the 5th"
    When the on-device attempts run
    Then the outcome is failed

  Scenario: A transaction verdict with an amount the code can read is parsed whatever the model said for the amount
    Given the model says transaction with no amount for "movie 20 on monday"
    When the on-device attempts run
    Then the outcome is parsed with amount 2000

  Scenario: A not-a-transaction verdict on text that names an amount is a refusal
    Given the model refuses "movie 20 on monday"
    When the on-device attempts run
    Then the outcome is refused

  Scenario: A not-a-transaction verdict on text with no amount is a failure so the heuristic asks how much
    Given the model refuses "what is my balance"
    When the on-device attempts run
    Then the outcome is failed

  Scenario: The explicit transactions command is never refused
    Given the model refuses "movie 20 on monday"
    When the on-device attempts run with forceExpense
    Then the outcome is failed

  Scenario: Log anyway on a no-amount draft reaches the how-much clarification
    Given the refused text "uber home"
    When I tap Log anyway and the draft is interpreted
    Then the reply asks how much it was

  Scenario: A refused metric row and its override resolution aggregate distinctly
    Given metric rows refused and overridden, refused and discarded, confirm and saved
    Then the refused outcome count is 2
    And the saved count is 1
    And the discarded count is 0
    And the refusals overridden count is 1
    And the refusals dismissed count is 1

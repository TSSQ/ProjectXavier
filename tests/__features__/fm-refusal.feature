Feature: An on-device FM refusal is not a failure, and is never silently logged
  When Foundation Models answers with a valid result that has no usable amount
  (its "not a transaction" sentinel), the app says so and offers "Log anyway"
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

  Scenario: A no-amount parse of text with no digits is a failure so the heuristic asks how much
    Given the model returns no amount for "lunch at Chipotle"
    When the on-device attempts run
    Then the outcome is failed

  Scenario: A no-amount parse of text that names an amount is a refusal
    Given the model returns no amount for "movie 20 on monday"
    When the on-device attempts run
    Then the outcome is refused

  Scenario: The explicit transactions command is never refused
    Given the model returns no amount for "movie 20 on monday"
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

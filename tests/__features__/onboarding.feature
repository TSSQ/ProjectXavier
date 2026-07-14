Feature: First-run guided onboarding (Xavier walks a new user through real setup)
  The pure onboarding brain: welcome -> account -> transaction -> done,
  advanced by real-flow events (accountCreated, transactionSaved) firing once
  the screen completes the actual account-Q&A / parse-confirm flows, or
  "skipped" from any step to always leave an escape hatch.

  Scenario: First run starts at the welcome step
    When onboarding starts
    Then the onboarding step should be "welcome"
    And Xavier's message should mention "no cloud"

  Scenario: The welcome beat hands off to the account step
    Given onboarding has started
    When the account step begins
    Then the onboarding step should be "account"

  Scenario: Creating the account advances to the transaction step
    Given onboarding is at the "account" step
    When the account is created
    Then the onboarding step should be "transaction"
    And Xavier's message should mention "spent"

  Scenario: Saving the first transaction advances to done and calls out the payee and category
    Given onboarding is at the "transaction" step
    When the transaction is saved with payee "Subway" and category "Dining"
    Then the onboarding step should be "done"
    And Xavier's message should mention "Subway" and "Dining"

  Scenario: Saving the first transaction with no payee or category still completes
    Given onboarding is at the "transaction" step
    When the transaction is saved with no payee or category
    Then the onboarding step should be "done"

  Scenario Outline: Skipping the tutorial from any step goes straight to done
    Given onboarding is at the "<step>" step
    When the tutorial is skipped
    Then the onboarding step should be "done"

    Examples:
      | step        |
      | welcome     |
      | account     |
      | transaction |

  Scenario: An event that doesn't match the current step is a no-op, and never blanks the message
    Given onboarding is at the "welcome" step
    When the account is created
    Then the onboarding step should be "welcome"
    And Xavier's message should not be empty

  Scenario: Once done, further events are a no-op, and never blank the message
    Given onboarding is at the "done" step
    When the account is created
    Then the onboarding step should be "done"
    And Xavier's message should not be empty

  Scenario: The onboarding-complete flag defaults to false when unset
    Given no stored onboarding-complete preference
    When the onboarding-complete preference is resolved
    Then the onboarding-complete flag should be false

  Scenario: A stored "1" resolves the onboarding-complete flag to true
    Given a stored onboarding-complete preference of "1"
    When the onboarding-complete preference is resolved
    Then the onboarding-complete flag should be true

  Scenario Outline: Any other stored value resolves the onboarding-complete flag to false
    Given a stored onboarding-complete preference of "<stored>"
    When the onboarding-complete preference is resolved
    Then the onboarding-complete flag should be false

    Examples:
      | stored |
      | 0      |
      | true   |
      |        |

Feature: Xavier's speech bubble confirms account changes
  Account confirmations say what changed (docs/design/xavier-speech-bubble-spec.md
  sections 5 and 7 item 6).

  Scenario: A created account shows its kind and opening balance
    When I create the account "OCBC 360" of kind "savings" with opening balance 5000 SGD
    Then the receipt headline should be "Created OCBC 360."
    And the receipt line should be "Savings · opening balance SGD 5,000.00"

  Scenario: A created account with no opening balance leaves it out
    When I create the account "OCBC 360" of kind "savings" with opening balance 0 SGD
    Then the receipt line should be "Savings"

  Scenario: A rename
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I update it to name "Travel" kind "cash" balance 100 SGD, balance edited "no"
    Then the bubble text should be "Renamed Wallet to Travel."

  Scenario: A retype
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I update it to name "Wallet" kind "savings" balance 100 SGD, balance edited "no"
    Then the bubble text should be "Wallet is now a savings account."

  Scenario: A balance change
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I update it to name "Wallet" kind "cash" balance 250 SGD, balance edited "yes"
    Then the bubble text should be "Set Wallet's balance to SGD 250.00."

  Scenario: A combined change leads with the first change
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I update it to name "Travel" kind "savings" balance 250 SGD, balance edited "yes"
    Then the bubble text should be "Renamed Wallet to Travel, and updated the rest."

  Scenario: An archived account
    Then the archived text for "Old Visa" should be "Archived Old Visa."

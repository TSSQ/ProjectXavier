Feature: A transfer's accounts named by part of their name
  "Transfer 1000$ from uob to citibank" with two UOB accounts used to take
  the source from the default account without a word, because "uob" is no
  account's FULL name (user report, build 125). The words after "from"/"to"
  now go through findAccountMatch: one fit resolves, several fits are never
  picked silently. Accounts: UOB One (default), UOB Savings, Citibank, Cash.

  Scenario: A partial source that fits two accounts is flagged on the card
    When I interpret the transfer "Transfer 1000$ from uob to citibank"
    Then the transfer should go from "UOB One" to "Citibank"
    And the card should say it could mean "UOB One, UOB Savings"
    And the source account should be marked as a guess

  Scenario: A partial source that fits one account resolves
    When I interpret the transfer "transfer 50 from savings to citibank"
    Then the transfer should go from "UOB Savings" to "Citibank"
    And the card should not flag an ambiguous account
    And the source account should not be marked as a guess

  Scenario: A full name still wins outright
    When I interpret the transfer "transfer 1000 from uob savings to citibank"
    Then the transfer should go from "UOB Savings" to "Citibank"
    And the card should not flag an ambiguous account

  Scenario: A partial destination that fits two accounts asks which
    When I interpret the transfer "transfer 50 from citibank to uob"
    Then the assistant should ask "Which account should I transfer to — UOB One or UOB Savings?"

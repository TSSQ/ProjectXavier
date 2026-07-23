Feature: Assistant account-creation flow (/account)
  The pure Q&A brain behind the "/account" command: recognising the command,
  walking name -> type -> starting balance, and reading answers deterministically
  into a ready-to-create account draft.

  Scenario: "/account" is recognised as the account command
    Then "/account" is an account command
    And "/account savings" is an account command
    And "spent 10 at the shop" is not an account command

  Scenario: The flow walks name, type, then balance to a ready draft
    When I start the account flow
    Then the assistant asks for the account name
    When I answer "DBS Savings"
    Then the assistant asks for the type
    When I answer "savings"
    Then the assistant asks for the starting balance
    When I answer "500"
    Then the account draft is ready
    And the ready account name is "DBS Savings"
    And the ready account subtype is "savings"
    And the ready account opening balance is 50000

  Scenario: "credit card" normalises to a credit_card subtype
    When I start the account flow
    And I answer "Amex"
    And I answer "credit card"
    And I answer "none"
    Then the ready account subtype is "credit_card"
    And the ready account opening balance is 0

  Scenario: Skipping the type leaves it unset
    When I start the account flow
    And I answer "Cash jar"
    And I answer "skip"
    And I answer "0"
    Then the ready account has no subtype

  Scenario: An "owe" balance is stored negative
    When I resolve the opening balance from "owe 200"
    Then the opening balance should be -20000

  Scenario: A plain dollar amount opening balance
    When I resolve the opening balance from "$1,250.50"
    Then the opening balance should be 125050

  Scenario: An empty name is re-asked
    When I start the account flow
    And I answer ""
    Then the assistant asks for the account name
    And the account draft is not ready

  Scenario: "/transactions" yields its body for expense parsing
    Then the transaction command body of "/transactions lunch 10 at subway" is "lunch 10 at subway"
    And the transaction command body of "spent 10" is null

  Scenario Outline: A subtype chip label advances the flow exactly like the typed word
    When I start the account flow
    And I answer "Corner store"
    Then advancing with the chip label "<label>" and typing "<typed>" reach the same subtype

    Examples:
      | label       | typed       |
      | Bank        | bank        |
      | Cash        | cash        |
      | Credit card | credit card |
      | Savings     | savings     |
      | Loan        | loan        |
      | Investment  | investment  |
      | Skip        | skip        |

  Scenario: ACCOUNT_SUBTYPE_CHOICES covers Loan and Investment (QA follow-up)
    # The chat gate legitimately produces loan/investment subtype hints
    # ("create a car loan account", "set up a Fidelity investment account")
    # — the confirm card's chip picker must be able to show/re-select both.
    Then the account subtype choices include "Loan" with value "loan"
    And the account subtype choices include "Investment" with value "investment"

  Scenario Outline: Deterministic default account name by subtype
    Then the default account name for subtype "<subtype>" is "<name>"

    Examples:
      | subtype     | name        |
      | cash        | Wallet      |
      | bank        | Savings     |
      | credit_card | Credit card |
      | loan        | Loan        |
      | investment  | Investment  |
      | unknown     | Account     |
      |             | Account     |

  Scenario Outline: Chat one-shot assembly always lands on a confirm-ready draft (spec §8 acceptance #4/#5)
    When I build a ready account from chat text "<text>" with extraction name "<name>" and subtype "<subtype>"
    Then the ready account name is "<readyName>"
    And the ready account subtype is "<readySubtype>"
    And the ready account opening balance is <balance>

    Examples:
      | text                                  | name        | subtype    | readyName   | readySubtype | balance |
      | make a wallet                         |             | cash       | Wallet      | cash         | 0       |
      | add a DBS savings account with 500    | DBS Savings | bank       | DBS Savings | bank         | 50000   |
      | open Amex card                        | Amex        | credit_card| Amex        | credit_card  | 0       |

  Scenario: Chat one-shot assembly with no engine available still yields a confirm-ready draft
    # The "deterministic floor" (spec §5.4 point 1): no engine ran at all, so
    # there's no extracted name — only the gate's own subtype hint survives —
    # yet the confirm card is still fully resolved, never a question/error.
    When I build a ready account from chat text "make a wallet" with extraction name "" and subtype "cash"
    Then the ready account name is "Wallet"
    And the ready account subtype is "cash"
    And the ready account opening balance is 0

  Scenario: Chat one-shot assembly with no extraction AND no gate hint at all still resolves
    When I build a ready account from chat text "add account" with no extraction at all
    Then the ready account name is "Account"
    And the ready account opening balance is 0

  Scenario: The opening balance always equals parseOpeningBalance(text), regardless of extraction
    When I build a ready account from chat text "open a loan account for $2,000" with extraction name "" and subtype "loan"
    Then the ready account opening balance is 200000

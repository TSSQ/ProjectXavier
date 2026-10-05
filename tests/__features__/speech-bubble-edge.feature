Feature: Xavier's speech bubble edge cases
  Budget states, months and currencies on a receipt; account retype wording;
  repeat labels; the accessibility label; delete copy; and the late-receipt guard
  (docs/design/xavier-speech-bubble-spec.md sections 5, 7 and 8).

  Scenario: A warn-state budget colours the meter warn
    Given a "Dining" budget of 100 SGD with 70 SGD already spent in "2026-10"
    When I save a 5 SGD expense to "Dining" on "2026-10-18"
    Then the budget state should be "warn"

  Scenario: Spending exactly the budget leaves zero and a full meter
    Given a "Food" budget of 30 SGD with 30 SGD already spent in "2026-10"
    When I save a 1 SGD expense to "Food" on "2026-10-18"
    Then the budget line should read "SGD 0" then "left in Food this month"
    And the budget used share should be 1

  Scenario: A save in another month names that month
    Given a "Food" budget of 30 SGD with 5 SGD already spent in "2026-09"
    When I save a 5 SGD expense to "Food" on "2026-09-05"
    Then the budget line should read "SGD 25" then "left in Food in September"

  Scenario: A foreign-currency expense keeps its own currency in the headline
    Given a "Food" budget of 30 SGD with 5 SGD already spent in "2026-10"
    When I save a 10 USD expense to "Food" on "2026-10-18"
    Then the receipt headline should be "Saved $10.00 to Food."
    And the budget line should read "SGD 25" then "left in Food this month"

  Scenario: A zero budget keeps the meter within bounds
    Given a budget view of 0 with 5 committed
    When I build the receipt for it
    Then the budget used share should be 1

  Scenario Outline: A retype reads as a sentence with the right article
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I retype it to "<kind>"
    Then the bubble text should be "<text>"

    Examples:
      | kind           | text                                         |
      | bank           | Wallet is now a bank account.                |
      | savings        | Wallet is now a savings account.             |
      | credit_card    | Wallet is now a credit card account.         |
      | loan           | Wallet is now a loan account.                |
      | investment     | Wallet is now an investment account.         |
      | emergency fund | Wallet is now an emergency fund account.     |
      | Savings        | Wallet is now a savings account.             |

  Scenario: A bank account retyped to cash
    Given the account "Wallet" of kind "bank" with balance 100 SGD
    When I retype it to "cash"
    Then the bubble text should be "Wallet is now a cash account."

  Scenario: A balance change is shown in the account's own currency
    Given the account "Wallet" of kind "cash" with balance 100 USD
    When I set its balance to 250
    Then the bubble text should be "Set Wallet's balance to $250.00."

  Scenario: A transaction update names what it changed
    When I update a "Subway" expense of 1 SGD in category "Dining" on account "Wallet"
    Then the receipt headline should be "Updated Subway."
    And the receipt line should be "🍔 Dining · Wallet · Today · SGD 1.00"

  Scenario: A category with no icon falls back to the tag emoji
    When I update a "Subway" expense of 1 SGD in category "Mystery" on account "Wallet"
    Then the receipt line should be "🏷️ Mystery · Wallet · Today · SGD 1.00"

  Scenario: Retyping to the same kind in a different case changes nothing
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I retype it to "CASH"
    Then the bubble text should be "Updated Wallet."

  Scenario: A kind already ending in account is not doubled
    Given the account "Wallet" of kind "cash" with balance 100 SGD
    When I retype it to "joint account"
    Then the bubble text should be "Wallet is now a joint account."

  Scenario Outline: A repeat label reads naturally
    When I set up a repeating series with "<rule>"
    Then the bubble text should be "<text>"

    Examples:
      | rule           | text                                         |
      | every 2 weeks  | Set up Netflix, SGD 15.00, repeating every 2 weeks. |
      | yearly         | Set up Netflix, SGD 15.00, repeating annually.      |
      | every 2 years  | Set up Netflix, SGD 15.00, repeating every 2 years. |
      | semi-annually  | Set up Netflix, SGD 15.00, repeating semi-annually. |
      | custom         | Set up Netflix, SGD 15.00, repeating.               |

  Scenario: The accessibility label reads the whole bubble with exact punctuation
    Then the label of a text bubble "Hi, I'm Xavier. Tell me more!" should be "Hi, I'm Xavier. Tell me more!"
    And the label of a plain line bubble "Which budget" should be "Which budget"
    And the label of the saved Food receipt should be "Saved SGD 5.00 to Food. 🏷️ Food · savings · Today. SGD 25 left in Food this month."
    And the label of the saved Food receipt without a budget should be "Saved SGD 5.00 to Food. 🏷️ Food · savings · Today."

  Scenario: Delete confirmations say what happened
    Then deleting one should read "Deleted."
    And deleting one transfer with "Wallet" should read "Deleted. Wallet's balance also changed."
    And deleting 3 should read "Deleted 3."
    And deleting 1 with "Wallet" should read "Deleted 1. Wallet's balance also changed."
    And deleting 2 with "Wallet, Visa" should read "Deleted 2. The balances of Wallet and Visa also changed."
    And deleting 3 with "Wallet, Visa, Cash" should read "Deleted 3. The balances of Wallet, Visa, and Cash also changed."

  Scenario: A late receipt never overwrites something newer
    Then a receipt started at stamp 4 should apply at stamp 4
    And a receipt started at stamp 4 should not apply at stamp 5

  Scenario: No source file asks "Anything else?"
    When I read the Assistant sources
    Then none of the sources should contain "Anything else?"

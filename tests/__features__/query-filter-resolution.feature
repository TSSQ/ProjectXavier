Feature: Ask-Xavier questions resolve the user's own words for categories, payees and accounts
  A question's category / payee / account word goes through a ladder
  (src/domain/queryFilterResolution.ts): exact name, then the user's term
  memory, then a fuzzy match, then a built-in synonym, then a union of
  several categories. Only when every rung fails does the tool run unfiltered
  with the honest "couldn't find" note. Kind scoping is absolute.

  Background:
    Given the expense categories "Dining, Groceries, Transport, Gym, Mall, All"
    And the income categories "Salary, Food Stall Sales"
    And the payees "McDonald's, Starbucks Reserve, Starbucks Airport, NTUC FairPrice"
    And the accounts "DBS Checking, Cash"
    And this month I spent 20.00 on Dining, 50.00 on Groceries, 7.00 on Transport and 30.00 on Gym
    And this month I earned 100.00 from Food Stall Sales

  Scenario: An exact name resolves exactly
    When I ask total_spent with category "dining"
    Then the category resolves "exact" to "Dining"
    And the total is 20.00 with no notes

  Scenario: A sentinel is no filter, but a real category with that name still resolves
    When I ask total_spent with category "any"
    Then there is no category filter
    And the total is 107.00 with no notes
    When I ask total_spent with category "all"
    Then the category resolves "exact" to "All"

  Scenario: A sentinel never fuzzes into a real name
    Given the expense categories "Dining, Mall"
    When I ask total_spent with category "none"
    Then there is no category filter

  Scenario: A typo resolves fuzzily
    When I ask total_spent with category "dinning"
    Then the category resolves "fuzzy" to "Dining"
    And the total is 20.00 with no notes

  Scenario: A short word never fuzzes into a different word
    When I ask total_spent with category "gas"
    Then the category does not resolve to "Gym"

  Scenario: A synonym resolves to the one category it names
    When I ask total_spent with category "grab"
    Then the category resolves "synonym" to "Transport"
    And the total is 7.00 with no notes

  Scenario: A concept matching several categories is a union, summed and named
    When I ask total_spent with category "food"
    Then the category resolves "union" to "Dining + Groceries"
    And the total is 70.00 with no notes
    And the caption reads "Spending on Dining + Groceries, this month."
    And the card line reads "Included Dining + Groceries for "food"."
    And the card offers the chips "Just Dining, Just Groceries"

  Scenario: An expense question never unions an income category
    When I ask total_spent with category "food"
    Then the category does not include "Food Stall Sales"

  Scenario: An income question only looks at income categories
    When I ask total_income with category "dining"
    Then the category resolves "none" to ""
    And the total is 100.00 with the note "couldn't find category "dining" — showing all"

  Scenario: A word no rung resolves keeps the honest note and runs unfiltered
    When I ask total_spent with category "zebras"
    Then the category resolves "none" to ""
    And the total is 107.00 with the note "couldn't find category "zebras" — showing all"

  Scenario: Term memory wins over the synonym and says "as last time"
    Given I taught "food" to mean "Groceries"
    When I ask total_spent with category "food"
    Then the category resolves "memory" to "Groceries"
    And the total is 50.00 with no notes
    And the card line reads "Read "food" as Groceries, as last time."
    And the card offers the chips "Not Groceries, Dining"

  Scenario: A remembered category that no longer exists is ignored
    Given I taught "food" to mean a deleted category
    When I ask total_spent with category "food"
    Then the category resolves "union" to "Dining + Groceries"

  Scenario: An exact name beats term memory
    Given I taught "dining" to mean "Groceries"
    When I ask total_spent with category "dining"
    Then the category resolves "exact" to "Dining"

  Scenario: Payee abbreviations and shared words resolve
    When I ask total_spent with payee "mcd"
    Then the payee resolves "fuzzy" to "McDonald's"
    When I ask total_spent with payee "ntuc"
    Then the payee resolves "fuzzy" to "NTUC FairPrice"
    When I ask total_spent with payee "starbucks"
    Then the payee resolves "union" to "Starbucks Reserve + Starbucks Airport"

  Scenario: An account typo is offered, never applied
    When I ask total_spent with account "Cahs"
    Then the account resolves "none" to ""
    And the card offers the chips "Cash"

  Scenario: Sub-categories count toward their parent
    Given the expense category "Coffee" under "Dining" with 4.00 spent this month
    When I ask total_spent with category "Dining"
    Then the total is 24.00 with no notes

  Scenario: Every filtering tool accepts the union
    When I ask spending_over_time with category "food"
    Then the trend sums to 70.00
    When I ask search_transactions with category "food"
    Then the search returns 2 rows

  Scenario: A member word never sums its siblings
    Given the expense categories "Utilities, Phone"
    When I ask total_spent with category "insurance"
    Then the category resolves "none" to ""

  Scenario: A member word reaches its umbrella category
    Given the expense categories "Transport, Parking"
    When I ask total_spent with category "gas"
    Then the category resolves "synonym" to "Transport"

  Scenario: A big union keeps the caption short and the card storable
    Given 15 payees named "NTUC FairPrice" with a branch number
    When I ask total_spent with payee "ntuc"
    Then the payee resolves "union" to 15 names
    And the caption reads "Spending on NTUC FairPrice 1 + NTUC FairPrice 2 + NTUC FairPrice 3 + 12 more, this month."
    And the answer is a valid chat card

  Scenario: A picked entity resolves by id even when two share a name
    Given the accounts "Savings, Savings"
    When I ask total_spent with account "savings"
    Then the account resolves "none" to ""
    When I pick account 2 for the word "savings"
    Then the account resolves "exact" to "Savings" with the id of account 2
    And the answer is a valid chat card

  Scenario: A history card asks no questions
    When I ask total_spent with account "Cahs"
    Then the history card line is empty

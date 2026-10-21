Feature: Question term memory remembers what a word in a question meant
  A chip tap on an answer card ("Just Dining") stores the user's word in
  phrase memory under a `q:` key (src/domain/phraseMemory.ts). It is applied
  to the next question with that word, reverted with the same two-strikes
  rule as transaction phrases, and never read as a transaction phrase.

  Scenario: The key is scoped and normalised
    Then the expense key for "  Food " is "q:expense:food"
    And the payee key for "McDonald's" is "q:payee:mcdonalds"
    And the expense key for "" is ""

  Scenario: A chip tap stores the word, and the next tap replaces it
    Given an empty phrase memory
    When I pick "Dining" for the expense word "food"
    Then the word "food" reads as "Dining" with 1 hit
    When I pick "Groceries" for the expense word "food"
    Then the word "food" reads as "Groceries" with 2 hits

  Scenario: Two reverts forget the word
    Given an empty phrase memory
    When I pick "Dining" for the expense word "food"
    And I revert the word "food"
    Then the word "food" reads as "Dining" with 1 hit
    When I revert the word "food"
    Then the word "food" is forgotten

  Scenario: Picking a different category starts the revert count again
    Given an empty phrase memory
    When I pick "Dining" for the expense word "food"
    And I revert the word "food"
    And I pick "Groceries" for the expense word "food"
    And I revert the word "food"
    Then the word "food" reads as "Groceries" with 2 hits

  Scenario: A question word is never a transaction phrase
    Given an empty phrase memory
    When I pick "Dining" for the expense word "food"
    Then looking up the transaction phrase "food" finds nothing

  Scenario: An income word is not read for an expense question
    Given an empty phrase memory
    When I pick "Salary" for the income word "pay"
    Then the expense word "pay" has no memory

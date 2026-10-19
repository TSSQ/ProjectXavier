Feature: Phrase memory learns from each user's own corrections
  People phrase things differently, so fixed word lists are only the seed:
  what the user confirmed last time for the same words is applied to the next
  draft, and a "Log anyway" or a discarded affirmation overrides the
  log-or-refuse decision next time (src/domain/phraseMemory.ts). On-device,
  per user, no network.

  Scenario Outline: The key is the words without the amount, the currency, the date and punctuation
    Then the phrase key of "<text>" is "<key>"

    Examples:
      | text                                   | key              |
      | 12 on lunch                            | on lunch         |
      | 12 on lunch?                           | on lunch         |
      | $15 on lunch yesterday                 | on lunch         |
      | Lunch 12                               | lunch            |
      | S$32 kopi                              | kopi             |
      | 2$ on drinks today                     | on drinks        |
      | coffee 4.5 ytd                         | coffee           |
      | paid 20 sgd for parking on 24/06/2026  | paid for parking |
      | McDonald's 9.90                        | mcdonald's       |
      | 12                                     |                  |
      | total 12.50 cash 20 change 7.50 thank you for shopping with us today | |

  Scenario: A question mark does not make a new phrase
    Then "12 on lunch" and "12 on lunch?" share a phrase key

  Scenario Outline: A memory is found by its exact key, else by one whole-word variant
    Given phrase memories for "on lunch, kopi o, kopi c"
    Then looking up "<key>" finds "<found>"

    Examples:
      | key      | found    |
      | on lunch | on lunch |
      | lunch    | on lunch |
      | kopi     |          |
      | dinner   |          |
      |          |          |

  Scenario: A remembered category replaces the engine's proposal and says so
    Given a memory for "on lunch" with category "Dining"
    And an engine draft for "12 on lunch" with category "Food"
    When the memory is applied
    Then the draft's category is "Dining" from phrase memory, revertible to "Food"

  Scenario: A category the user typed wins over the memory
    Given a memory for "lunch food" with category "Dining"
    And an engine draft for "lunch food 12" with category "Food"
    When the memory is applied
    Then the draft's category is "Food" with nothing learned

  Scenario: Phrase memory outranks the payee's learned default
    Given a memory for "kopitiam" with category "Dining"
    And the payee "Kopitiam" remembers category "Groceries"
    And an engine draft for "kopitiam 5" with category "Food" and payee "Kopitiam"
    When the memory and then the payee defaults are applied
    Then the draft's category is "Dining" from phrase memory, revertible to "Food"

  Scenario: With no memory the payee's learned default still applies
    Given no phrase memories
    And the payee "Kopitiam" remembers category "Groceries"
    And an engine draft for "kopitiam 5" with category "Food" and payee "Kopitiam"
    When the memory and then the payee defaults are applied
    Then the draft's category is "Groceries" from the payee's default

  Scenario: A remembered payee fills a draft the engine left without one
    Given a memory for "on lunch" with payee "Koufu"
    And an engine draft for "12 on lunch" with no payee
    When the memory is applied
    Then the draft's payee is "Koufu" from phrase memory
    When the payee is reverted
    Then the draft has no payee and nothing learned

  Scenario: A payee the user typed wins over the memory
    Given a memory for "kopi" with payee "Kopitiam"
    And an engine draft for "kopi 2" with payee "kopi"
    When the memory is applied
    Then the draft's payee is "kopi" with nothing learned

  Scenario: A remembered account is used only when the engine named none
    Given a memory for "on lunch" with account "Card"
    And an engine draft for "12 on lunch" on the default account
    When the memory is applied
    Then the draft is on account "Card" from phrase memory
    Given an engine draft for "12 on lunch" on account "Cash" the user named
    When the memory is applied
    Then the draft is on account "Cash" with nothing learned

  Scenario: A remembered type comes with its category, and reverts with it
    Given a memory for "tutoring" with type "income" and category "Side income"
    And an engine draft for "tutoring 50" with category "Food"
    When the memory is applied
    Then the draft is "income" with category "Side income" from phrase memory
    When the type is reverted
    Then the draft is "expense" with category "Food"

  Scenario: Words that decide the type keep it
    Given a memory for "paid tutoring" with type "income" and category "Side income"
    And an engine draft for "paid tutoring 50" with category "Food"
    When the memory is applied
    Then the draft is "expense" with category "Food"

  Scenario: A transfer draft is never changed, and a forgotten category is ignored
    Given a memory for "on lunch" with category "Deleted"
    And an engine draft for "12 on lunch" with category "Food"
    When the memory is applied
    Then the draft's category is "Food" with nothing learned
    Given a memory for "to savings" with category "Dining"
    And a transfer draft for "200 to savings"
    When the memory is applied
    Then the draft is unchanged

  Scenario: "Log anyway" teaches a verdict that overrides the next refusal of the same words
    Given no phrase memories
    When the user taps "Log anyway" on "12 on lunch?"
    Then the memory for "on lunch" has verdict "log"
    And a refusal of "15 on lunch" is overridden

  Scenario: A discarded affirmation keeps the next affirmation of the same words refused
    Given no phrase memories
    When the user discards a draft code affirmed for "goal 5000"
    Then the memory for "goal" has verdict "not_log"
    And an affirmation by code of "goal 300" stays a refusal
    And the model's own "this is a transaction" for "goal 300" is not overridden

  Scenario: Saving the words after a 'not_log' turns the verdict back to 'log'
    Given no phrase memories
    When the user discards a draft code affirmed for "goal 5000"
    And the user saves "goal 5000" as an expense in "Dining"
    Then the memory for "goal" has verdict "log" and 1 hit

  Scenario: The pipeline reports when code, not the model, affirmed the transaction
    When the model refuses "taxi 18 tomorrow" and the parse is finished and classified
    Then the outcome is parsed and says code affirmed it

  Scenario: Two reverts forget a memory
    Given a memory for "on lunch" with category "Dining"
    When the user reverts a field that memory applied
    Then the memory for "on lunch" has 1 revert
    When the user reverts a field that memory applied
    Then there is no memory for "on lunch"

  Scenario: The store is capped and the least recently used phrase goes first
    Given 3 phrase memories used at 1, 2 and 3 with a cap of 3
    When the user saves "kopi 2" at 10
    Then the memories kept are "kopi, used-2, used-3"

  Scenario: A confirmed parse teaches the memory after the row is written
    Given a draft for "12 on lunch" with category "Dining" ready to save
    When it is saved
    Then phrase memory was taught after the row was written
    And the memory for "on lunch" has category "cat-1" and 1 hit

  Scenario: A failure to remember never fails the save
    Given a draft for "12 on lunch" with category "Dining" ready to save
    And phrase memory cannot be written
    When it is saved
    Then the save returned the new transaction id

  Scenario: The diagnostics count memory hits and how often they were kept
    Given parse metric rows on "on_device": an applied memory saved as shown, an applied memory edited, and a plain save
    Then the engine shows 2 memory applications, 1 kept

  Scenario: The memory detail is merged into the row's other detail
    Then the memory detail on a fallback row reads fmFallback "threw" and phraseMemory "applied"

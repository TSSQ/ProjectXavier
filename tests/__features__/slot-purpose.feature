Feature: The purpose tail becomes the note and, where the model gave none, the category
  When the slot reader (src/domain/slotReader.ts) reads who gave money to whom,
  the "for|on <phrase>" tail says what the money was for. `finishFmParse` keeps
  it as the note in the user's own words, even when short ("lunch"), unless it
  only restates the payee or the category; `groundedNote`'s rules still apply
  to every note the slot reader did not produce. The tail also names the
  category, through D1's ladder (src/domain/slotCategory.ts), when the model
  gave none of the user's, scoped to the transaction's kind.

  Background:
    Given the user's categories are "Food:expense, Groceries:expense, Transport:expense, Entertainment:expense, Salary:income, Allowance:income"
    And the user's payees are "Brother, Mum, Sister, Grab"

  Scenario Outline: The tail is the note, kept short, in the user's own spelling
    Given the model answered type "<model type>", category "<model category>" and note "<model note>" for "<text>"
    When the parse is finished
    Then the finished category is "<category>" and note "<note>"

    Examples:
      | text                                 | model type | model category | model note | category  | note           |
      | paid sis 25 for lunch                | expense    | none           | none       | Food      | lunch          |
      | I gave bro 20 for Lunch yesterday    | expense    | none           | none       | Food      | Lunch          |
      | sent mum $30 for groceries           | expense    | none           | none       | Groceries | none           |
      | paid Grab 8 for the ride             | expense    | none           | none       | Transport | the ride       |
      | gave bro 15 for taxi                 | expense    | Shopping2      | none       | Transport | taxi           |
      | paid sis 12 for kopi                 | expense    | Groceries      | none       | Groceries | kopi           |
      | sis paid me back 15 for movie tickets | income    | none           | none       | none      | movie tickets  |
      | got 30 from dad for taxi             | expense    | none           | none       | none      | taxi           |
      | paid sis 25 for dinner with the team | expense    | Food           | dinner with the team | Food | dinner with the team |
      | paid Grab 8 for Grab                 | expense    | none           | none       | Transport | none           |

  Scenario Outline: A note the slot reader did not produce keeps every groundedNote rule
    Given the model answered type "expense", category "none" and note "<model note>" for "<text>"
    When the parse is finished
    Then the finished category is "<category>" and note "<note>"

    Examples:
      | text               | model note | category | note |
      | 12 bucks lunch     | lunch      | none     | none |
      | coffee 4           | coffee     | none     | none |
      | Sam paid 40 for dinner | dinner | none     | none |

  Scenario Outline: The tail's category comes from the ladder for the transaction's kind
    Then the purpose "<purpose>" for a "<type>" files under "<category>"

    Examples:
      | purpose        | type    | category  |
      | lunch          | expense | Food      |
      | the team lunch | expense | Food      |
      | mcd            | expense | Food      |
      | kopi           | expense | Food      |
      | taxi           | expense | Transport |
      | her grab ride  | expense | Transport |
      | groceries      | expense | Groceries |
      | the concert    | expense | Entertainment |
      | taxi           | income  | none      |
      | allowance      | income  | Allowance |
      | the household  | expense | none      |

  Scenario: A meal files under Dining when the user has Dining and Groceries but no Food
    Given the user's categories are "Dining:expense, Groceries:expense, Transport:expense"
    Then the purpose "lunch" for a "expense" files under "Dining"

  Scenario: The heuristic floor takes the note and category from the tail too
    When I locally parse "paid sis 25 for lunch"
    Then the heuristic category is "Food" and note "lunch"

  Scenario: A category from the tail is flagged on the card
    Given a draft whose category the slot reader set from the tail
    Then the draft's category is flagged as defaulted
    And its applied defaults are "slot:category, slot:note"

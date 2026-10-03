Feature: "Can I afford it?" is answered from the budget
  An afford question with an amount routes to an answer instead of a refusal;
  without an amount (or with an ambiguous one, or when money already moved) it
  keeps today's behaviour. The verdict, the reply copy and the category choice
  are deterministic (spec sections 4.6 and 6.2).

  Scenario Outline: Afford questions with an amount route to afford
    Then "<text>" should route to afford with amount <amount>

    Examples:
      | text                           | amount |
      | can I afford a 300 phone       | 300    |
      | can afford 300$ phone          | 300    |
      | can I afford dinner out for 60?| 60     |
      | Can I afford a $300 phone? I have 500 left | 300 |
      | can I afford 50. I have 20 left | 50 |

  Scenario Outline: Everything else keeps today's behaviour
    Then "<text>" should not route to a budget answer

    Examples:
      | text                                                   |
      | can I afford it                                        |
      | can I afford a 300 phone, already spent 500 this month |
      | I can afford 300 phone now, bought it                  |
      | should I buy a 300 phone                               |
      | could I afford a 2000 holiday                          |
      | can I afford 300 phone bought it yesterday             |

  Scenario: A refused afford text with no amount is still refused as before
    Then the cue check should still refuse "can I afford a 300 phone, already spent 500 this month"
    And the cue check should still log "I can afford 300 phone now, bought it"

  Scenario: A purchase that fits
    Given the mockup fixture on October 18
    When I ask whether Dining can afford 60
    Then the verdict should be fits with 188 left now and 128 after
    And the reply should read "Yes. Dining would still have $128 for the next 13 days, about $10 a day."

  Scenario: A purchase that does not fit
    Given the mockup fixture on October 18
    When I ask whether Shopping can afford 300 for "can I afford a 300 phone"
    Then the verdict should be over with 120 left now and -180 after
    And the reply should read "Not from Shopping. It has $120 left, so a $300 phone would put it $180 over."
    And the all-budgets line should read "All budgets together would still have $363 left."

  Scenario: Without a noun the reply says "this"
    Given the mockup fixture on October 18
    When I ask whether Shopping can afford 300 for "can I afford 300"
    Then the reply should read "Not from Shopping. It has $120 left, so this would put it $180 over."

  Scenario: The all-budgets line is hidden when nothing would be left
    Given the mockup fixture on October 18
    When I ask whether Shopping can afford 800
    Then the verdict should be over with 120 left now and -680 after
    And there should be no all-budgets line

  Scenario: Against all budgets together
    Given the mockup fixture on October 18
    When I ask whether all budgets can afford 300
    Then the reply should read "Yes. All budgets together would still have $363 left."
    When I ask whether all budgets can afford 700
    Then the reply should read "Not this month. All budgets together have $663 left."

  Scenario: On the last day the per-day figure is dropped
    Given a Dining budget of 600 with 412 spent on October 31
    When I ask whether Dining can afford 60
    Then the reply should read "Yes. Dining would still have $128 this month."

  Scenario: The category comes from the existing deterministic inference
    Given the mockup fixture on October 18
    And a payee "Subway" whose default category is Dining
    Then the category for "dining 60" should be Dining
    And the category for "lunch at Subway 60" should be Dining
    And the category for "a gift for 80" should be unknown

  Scenario: An unclear category asks which budget, in attention order
    Given the mockup fixture on October 18
    When I ask about "a gift for 80" for 80
    Then the reply should read "Which budget would this come from?"
    And the chips should be "Entertainment, Dining, Shopping, Groceries, Bills, Transport" plus all budgets

  Scenario: No budgets at all
    Given a ledger with no budgets on October 18
    When I ask about "a 300 phone" for 300
    Then the reply should read "You haven't set any budgets yet."

  Scenario: A second sentence never becomes the logged amount
    Then "Can I afford a $300 phone? I have 500 left" should log "a $300 phone"
    And an afford of 300 for "a phone" should log "a phone 300"

  Scenario: Log it presets the budget's category unless the parse found a subcategory of it
    Given a Dining budget with a Takeout subcategory and a Groceries category
    Then a draft in "Takeout" should keep its category for the Dining budget
    And a draft in "Groceries" should be preset to "Dining"
    And a draft with no category should be preset to "Dining"

  Scenario: The past-tense guard reads only the question's own sentence
    Then "can I afford 300 phone. bought it yesterday" should route to afford and log "300 phone"

  Scenario: A stale chip pointing at a removed budget asks again instead of claiming there are none
    Given the mockup fixture on October 18
    When the Dining budget is removed and I answer a chip for Dining
    Then the plan should ask which budget, offering the remaining budgets

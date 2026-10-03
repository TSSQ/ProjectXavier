Feature: A deterministic cue check refuses questions, plans, budgets and IOUs before the model
  The iPhone's on-device model answers "this is a transaction" for text the
  Mac's model refuses, so code catches the obvious cases first. It is
  conservative: a false refusal of a real expense is the costly error.

  Scenario Outline: Each cue family fires on text that names an amount
    When the cue check runs on "<text>"
    Then the cue is "<cue>"

    Examples:
      | text                                   | cue              |
      | should i buy 50$ jacket                | should-i         |
      | can I afford a 300 phone               | can-i            |
      | could I spend 40 on a gift             | could-i          |
      | is it worth paying 15 for parking      | worth            |
      | worth it? 60 for a day pass            | worth            |
      | what if rent goes up to 1500           | leading-question |
      | transfer 500 to savings next month     | future-transfer  |
      | will transfer 500 to savings on monday | intent           |
      | how much should I spend, 400?          | how-much-should  |
      | Sam owes me 15 for lunch               | owes-me          |
      | save 150 a month, I save 150 a month   | i-save           |
      | is 12 too much for a coffee            | leading-question |
      | thinking of buying a 400 monitor       | intent           |
      | planning to spend 150 on gifts         | intent           |
      | gonna buy lunch for 12 tomorrow        | intent           |
      | I'll pay 30 for the dinner tomorrow    | intent           |
      | will buy a 35 cake on saturday         | intent           |
      | remind me to pay the 120 bill          | remind-me        |
      | need to pay 40 for parking on saturday | future-obligation |
      | budget 200 for groceries               | budget           |
      | my budget is 500 a month               | budget           |
      | set aside 200 for travel               | set-aside        |
      | saving for a 1500 laptop               | save-up          |
      | save up 300 for the trip               | save-up          |
      | I owe Maya 40                          | owe              |
      | owe Tom 20                             | owe              |
      | Priya owes me 45                       | owes-me          |

  Scenario Outline: Real expenses with cue-like words are not refused
    When the cue check runs on "<text>"
    Then no cue fires

    Examples:
      | text                                         |
      | paid my budget app subscription 5            |
      | Budget Rent a Car 85                         |
      | bought budget airline ticket 120             |
      | worth 20 lunch                               |
      | worth it, bought umbrella 15                 |
      | owed tax paid 300                            |
      | Sam repaid the 20 he owed me                 |
      | paid Sam what I owed him 20                  |
      | paid back Sam 20                             |
      | asked 'should I?' then bought shoes 80       |
      | dinner 30?                                   |
      | was gonna buy shoes but got a hat 25         |
      | thought about it all week, finally bought the 80 jacket |
      | planning dept permit fee 40                  |
      | Will's cafe 12                               |
      | lunch 12 tomorrow                            |
      | saved 20 with coupon, groceries 60           |
      | need to pay rent, paid 1200                  |
      | paid 100 deposit, will pay balance next week |
      | bought groceries 60, will buy more tomorrow |
      | owe nothing paid 20 |
      | paid 200 to saving for house account |
      | paid rent 1200, next one is due on 1st |
      | remind me paid 20 |
      | I save 5 at ntuc paid 40 |
      | Bob owes me 20 settled, paid 20 |
      | worth it? bought 50 |
      | could not find change, paid 3 for parking |
      | will call taxi, paid 15 |
      | paid 40 for parking should i expense it |
      | coffee 4 could i be any more tired |
      | paid what if 5 |
      | transferred 500 to savings |
      | can of coke 2 |
      | Do Thai 12 |
      | What A Burger 9 |
      | How Kee rice 5 |
      | Is coffee 4 |
      | Does bakery 3 |
      | Will 20 |
      | Should 5 |
      | Can Can Cafe 14 |
      | Will Smith ticket 30 |
      | Shall We Dine 40 |
      | Why Not Cafe 8 |
      | Do Re Mi 5 |
      | Are We There Yet 5 |
      | How's Bar 20 |
      | What The Fries 9 |
      | WILL 20 |
      | CAN of Coke 2 |
      | can or not, paid 10 lah |
      | how ah, 5 kopi |
      | what a day, taxi 30 |
      | does it matter, 40 lunch |
      | Budget Taxi 12 |
      | Budget Inn 90 |
      | budget meal 12 |
      | budget app 30 |
      | Budget Car 2 days 100 |
      | Budget 4 nights 90 |
      | budget 3 star hotel 200 |
      | Budget 7-eleven 4 |
      | Budget 30 lunch |
      | dinner 80, Mei will pay me back her half |
      | lunch 40 Sam will pay me back |
      | coffee 5 planning to walk after |
      | phone plan get 30 |
      | data plan pay 20 |
      | he will pay 20, I got 20 |
      | saving for house transfer 200 |
      | Saving for Tomorrow fee 20 |
      | Owe Money loan repayment 300 |
      | Dad owes me; lunch 20 paid |
      | Sam owes me 20 lunch |
      | Remind Me Cafe 20 |

  Scenario: A cue with no amount evidence does not refuse
    When the cue check runs on "should i buy a jacket"
    Then the text has a cue but the gate does not refuse it

  Scenario: forceExpense bypasses the check entirely
    When the cue check runs on "should i buy 50$ jacket" with forceExpense
    Then the gate does not refuse it

  Scenario: The cue is logged as a content-free detail the fallback counter ignores
    When the cue detail for "should-i" is built
    Then it is {"notTransactionCue":"should-i"} and the fallback counts are empty

  Scenario: Cue refusals are counted by how the user answered
    Given parse metric rows refused by a cue and logged anyway, accepted, accepted, still open and refused by the model
    Then the cue counts are overridden 1 and discarded 2
    And the aggregate cue counts are overridden 1 and discarded 2

  Scenario: The debug screen shows the model verdict, the outcome and the cue
    Given the model answered isTransaction true for "should i buy 50$ jacket" with amount 5000
    When the debug view is built
    Then the verdict is "transaction", the model outcome is "parsed", the cue is "should-i" and the app outcome is "refused"

  Scenario: The debug screen shows a model refusal with no cue
    Given the model answered isTransaction false for "my pin is 1234"
    When the debug view is built
    Then the verdict is "not a transaction", the model outcome is "refused", there is no cue and the app outcome is "refused"

  Scenario: The debug screen reports a throw as no answer
    Given the model threw for "coffee 4"
    When the debug view is built
    Then the verdict is "no answer", the model outcome is "failed", there is no cue and the app outcome is "failed"

  Scenario: The debug screen flags a cue that lacks an amount
    Given the model answered isTransaction true for "should i buy a jacket" with amount 0
    When the debug view is built
    Then the cue is only noted as "should-i" without an amount

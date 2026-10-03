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
      | what if I spent 250 on shoes           | what-if          |
      | how much should I spend, 400?          | how-much-should  |
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

  Scenario: A cue with no amount evidence does not refuse
    When the cue check runs on "should i buy a jacket"
    Then the text has a cue but the gate does not refuse it

  Scenario: forceExpense bypasses the check entirely
    When the cue check runs on "should i buy 50$ jacket" with forceExpense
    Then the gate does not refuse it

  Scenario: The cue is logged as a content-free detail the fallback counter ignores
    When the cue detail for "should-i" is built
    Then it is {"notTransactionCue":"should-i"} and the fallback counts are empty

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

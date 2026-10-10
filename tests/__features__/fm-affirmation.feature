Feature: An obvious transaction the on-device model refused is kept as a cold-start miss
  On the dev split the model answers "not a transaction" for real spends that
  carry a future- or question-like word ("movie 20 on monday", "Do Thai 12",
  "Budget Taxi 12") although no cue fires. Code decides where it can: a strict
  past-tense money verb, or a terse "<one to four words> <amount>" log, keeps
  the parse with the code-read amount. Every refusal that should still refuse
  does (src/domain/fmRefusal.ts, `affirmsTransaction`).

  Scenario Outline: A terse log or a past-tense spend the model refused is affirmed
    Then the refusal of "<text>" is affirmed as "<reason>"

    Examples:
      | text                                         | reason    |
      | movie 20 on monday                           | terse-log |
      | taxi 18 tomorrow                             | terse-log |
      | snack 4 tomorrow                             | terse-log |
      | bus 3 on tuesday                             | terse-log |
      | Budget Taxi 12                               | terse-log |
      | Budget 30 lunch                              | terse-log |
      | Remind Me Cafe 20                            | terse-log |
      | coffee 4 could i be any more tired           | terse-log |
      | Do Thai 12                                   | terse-log |
      | What A Burger 9                              | terse-log |
      | Can Can Cafe 14                              | terse-log |
      | dinner 30?                                   | terse-log |
      | lunch 12 last friday                         | terse-log |
      | rent 1500 on the 1st                         | terse-log |
      | snack $0.80                                  | terse-log |
      | paid S$32 for dinner                         | past-verb |
      | paid 100 deposit, will pay balance next week | past-verb |
      | lol spent 40 on bbt 🧋                       | past-verb |
      | bought groceries 60, will buy more tomorrow  | past-verb |

  Scenario Outline: A refusal the code cannot read as a log stays refused
    Then the refusal of "<text>" stands

    Examples:
      | text                                        |
      | my pin is 1234                              |
      | my locker code is 4471                      |
      | room 204 please                             |
      | Sam owes me 20 lunch                        |
      | paying the 300 deposit tomorrow             |
      | call me at 5 or 6                           |
      | meeting moved to 12/03 at 9:30              |
      | set a timer for 10 minutes                  |
      | lunch 12 if I go                            |
      | should I buy the 80 dollar shoes            |
      | I owe Maya 40                               |
      | budget 200 for groceries next month         |
      | remind me to pay the 120 bill on the 5th    |
      | is 50 a lot for dinner                      |
      | what's the capital of France                |
      | paid 45 and then 9.60 for lunch             |
      | lunch 12 tomorrow i'll pay                  |
      | the password 2024 for wifi                  |

  Scenario Outline: The affirmed parse carries the code-read amount, the typed date and the verdict
    Given the model refuses "<text>"
    When the FM parse is finished at 2026-07-16
    Then the parse is a transaction with amount <amount> dated <date> affirmed as "<reason>"

    Examples:
      | text                 | amount | date       | reason    |
      | movie 20 on monday   | 2000   | 2026-07-13 | terse-log |
      | taxi 18 tomorrow     | 1800   | 2026-07-16 | terse-log |
      | paid 100 deposit, will pay balance next week | 10000 | 2026-07-16 | past-verb |

  Scenario: An affirmed refusal is a parsed outcome and costs no second generation
    Given the model refuses "Budget Taxi 12" on every attempt
    When the on-device attempts run
    Then the outcome is parsed with amount 1200
    And 1 attempt was made

  Scenario: A refusal that stands is still final and not retried
    Given the model refuses "my pin is 1234" on every attempt
    When the on-device attempts run
    Then the outcome is refused
    And 1 attempt was made

  Scenario: A refusal under forceExpense is still a failure, not an affirmation question
    Given the model refuses "my pin is 1234" on every attempt
    When the on-device attempts run with forceExpense
    Then the outcome is failed

  Scenario: The debug view shows the model's own verdict and the affirmation
    Given the model refuses "Do Thai 12"
    When the FM parse is finished at 2026-07-16
    And the debug view is built
    Then the view shows verdict "not a transaction", app outcome "parsed" and affirmation "terse-log"

  Scenario: The affirmed parse does not carry the verdict or the affirmation once classified
    Given the model refuses "Budget Taxi 12" on every attempt
    When the on-device attempts run
    Then the parsed expense has no isTransaction or affirmed key

Feature: Code decides the transaction type where the user's words are unambiguous
  Step 3's rule applied to `type`: the on-device model answered income for
  "paid back Sam 20" and transfer for "courts furniture 450" on the dev split.
  A deterministic reader (src/domain/signReader.ts) decides the sign from the
  words where they decide it and leaves the model's answer alone elsewhere.

  Scenario Outline: Income words, a leading plus and received money are income
    Then the sign read from "<text>" is "income"

    Examples:
      | text                               |
      | +3200 payday                       |
      | returned shoes +59                 |
      | +200 ang bao from grandma          |
      | +45 cashback from the card         |
      | refund 20 from Amazon              |
      | Lazada refunded me 23.90           |
      | partial refund 10 for late delivery |
      | reimbursed by boss 45              |
      | cashback 15 from Shopee            |
      | received 250 USD from a client     |
      | salary 3200                        |
      | got paid 1200                      |
      | Priya paid me back 45              |
      | found 20 on the street             |
      | Sam repaid the 20 he owed me       |
      | freelance logo job paid 350        |
      | deposit 300                        |
      | bank interest 3.47                 |
      | dividend 120                       |
      | sold old phone 300                 |
      | birthday gift from Aunt Lin 85     |
      | money back for the cancelled flight 310 |
      | aunt gave me 50 red packet         |
      | freelance payment 600              |
      | tax refund 300 for the late fee    |

  Scenario Outline: Spend verbs and spend nouns are expenses, whatever else the text says
    Then the sign read from "<text>" is "expense"

    Examples:
      | text                                         |
      | paid back Sam 20                             |
      | paid Sam what I owed him 20                  |
      | owed tax paid 300                            |
      | owe nothing paid 20                          |
      | paid 100 deposit, will pay balance next week |
      | paid 80 deposit for the venue                |
      | lunch 40 Sam will pay me back                |
      | treated bestie to 30 dinner, she'll pay me back |
      | dinner 80, Mei will pay me back her half     |
      | planning dept permit fee 40                  |
      | gift 35 last sunday                          |
      | gave mum 50                                  |
      | bought budget airline ticket 120             |
      | paid loan interest 30                        |
      | donation 30 to charity                       |
      | received the bill, paid 50                   |
      | sold out, bought tickets 50                  |

  Scenario Outline: A transfer needs a transfer verb and one of the user's own accounts
    Given the user's accounts are "Checking, Cash"
    Then the sign read from "<text>" is "transfer"

    Examples:
      | text                               |
      | transferred 200 to savings         |
      | moved 500 between accounts         |
      | moved 200 from cash to checking    |
      | auto-transfer 100 to savings       |
      | put 1000 into fixed deposit        |
      | topped up wallet 50                |
      | withdrew 200 from atm              |

  Scenario Outline: A transfer verb pointed at a person is a payment, not a transfer
    Given the user's accounts are "Checking, Cash"
    Then the sign read from "<text>" is "expense"

    Examples:
      | text                        |
      | transferred 150 to mum      |
      | sent 40 to Sam              |

  Scenario Outline: A partial account name after "to" still names the user's own account
    Given the user's accounts are "DBS Savings, UOB One, Budget, Visa"
    Then the sign read from "<text>" is "transfer"

    Examples:
      | text                          |
      | transferred 300 to dbs        |
      | moved 50 to my uob            |
      | transferred 500 from budget to visa as credit card payment |

  Scenario Outline: Where the words leave the type open, the reader says nothing
    Then the sign read from "<text>" is undecided

    Examples:
      | text                                   |
      | coffee 4.80                            |
      | courts furniture 450                   |
      | lunch 12 +2 tip                        |
      | received 20 then paid 50               |
      | transferred 150 to mum                 |
      | mrt top up 20                          |
      | withdrew 100                           |
      | paid 500 to credit card                |

  Scenario Outline: The pipeline keeps the model's type where the reader is undecided
    Given the model's type is "<model>"
    Then the resolved type for "<text>" is "<type>"

    Examples:
      | text                 | model   | type    |
      | coffee 4.80          | expense | expense |
      | freelance payment 600 | income | income  |
      | paid back Sam 20     | income  | expense |
      | returned shoes +59   | transfer | income |

  Scenario Outline: A model transfer that nothing in the text supports becomes an expense
    Given the model's type is "transfer"
    Then the resolved type for "<text>" is "<type>"

    Examples:
      | text                                   | type    |
      | courts furniture 450                   | expense |
      | gym membership 80                      | expense |
      | dividend 120                           | income  |

  Scenario Outline: A model transfer with a transfer verb or an account word is kept
    Given the user's accounts are "Checking, Cash"
    And the model's type is "transfer"
    Then the resolved type for "<text>" is "transfer"

    Examples:
      | text                                   |
      | paid 500 to credit card                |
      | 300 to savings                         |
      | withdrew 100                           |

  Scenario Outline: A transaction-kind word is never a payee
    Then "<word>" is a transaction-kind word, not a payee

    Examples:
      | word     |
      | payday   |
      | gift     |
      | tax      |
      | Salary   |
      | the fee  |

  Scenario Outline: A merchant or person is not a transaction-kind word
    Then "<word>" can be a payee

    Examples:
      | word        |
      | Sam         |
      | Courts      |
      | Gift Garden |

  Scenario Outline: The on-device parse takes the read sign over the model's and drops a kind-word payee
    Given the model logged "<text>" as "<model>" with payee "<payee>"
    When the FM parse is finished
    Then the finished parse has type "<type>" and payee <result>

    Examples:
      | text                 | model    | payee   | type    | result   |
      | +3200 payday         | income   | payday  | income  | none     |
      | gift 35 last sunday  | income   | gift    | expense | none     |
      | paid back Sam 20     | income   | Sam     | expense | "Sam"    |
      | owed tax paid 300    | income   | tax     | expense | none     |
      | courts furniture 450 | transfer | Courts  | expense | "Courts" |
      | found 20 on the street | expense | none   | income  | none     |
      | returned shoes +59   | transfer | none    | income  | none     |

  Scenario: The on-device parse uses the user's accounts for the transfer rule
    Given the user's accounts are "Checking, Cash"
    And the model logged "transferred 150 to mum" as "transfer" with payee "mum"
    When the FM parse is finished
    Then the finished parse has type "expense" and payee "mum"

  Scenario Outline: The heuristic floor uses the same reader where it decides
    When I locally parse "<text>"
    Then the heuristic type is "<type>"

    Examples:
      | text                        | type     |
      | paid back Sam 20            | expense  |
      | Priya paid me back 45       | income   |
      | returned shoes +59          | income   |
      | transfer 100 to savings     | transfer |
      | received 500 salary         | income   |
      | 20 tacos                    | expense  |
      | transferred 150 to mum      | transfer |

Feature: On-device parse takes the amount out of the model's hands where code can read it
  Step 3. Per text, code reads the amount candidates and the FM parse follows one
  of three plans: a single candidate is used as is, several become a closed
  choice for the model, and with none the model's own number is trusted only
  when the text supports it.

  Scenario Outline: The plan follows the number of candidates
    Then the amount plan for "<text>" is "<mode>"

    Examples:
      | text                            | mode   |
      | coffee 4.80                     | single |
      | paid 45 and then 9.60 for lunch | choice |
      | lunch at the food court         | model  |
      | due on the 5th                  | model  |
      | a couple hundred for rent       | model  |
      | coffee ๕๐                       | model  |
      | coffee 五十                     | model  |
      | rent 1.250                      | choice |

  Scenario Outline: Single only when the reading is unambiguous
    Then the amount plan for "<text>" is "<mode>"

    Examples:
      | text                               | mode   |
      | Rs.500.00 debited from a/c XX1234  | single |
      | Rs.2,499 Amazon                    | single |
      | Rp.50.000 parking                  | single |
      | $1 250                             | single |
      | +3200 payday                       | single |
      | 20 dollars and 50 cents            | single |
      | a dollar 50                        | single |
      | salary of 2000                     | single |
      | in 2026 coffee 5                   | single |
      | dinner for 4 120                   | choice |
      | bought 3 450 total                 | choice |
      | lunch 12 +2 tip                    | choice |
      | coffee 5 -1 voucher                | choice |
      | apt 5c rent 1200                   | single |
      | seat 14c lunch 12                  | single |
      | bus 17 1.89                        | single |
      | 2 tickets @ 15                     | choice |
      | dinner for 4, two hundred          | choice |
      | paid twenty for 2 tickets          | choice |
      | two fifty for 3 coffees            | choice |
      | bought one coffee                  | model  |
      | $20 for two tickets                | single |
      | uber 23 incl $3 tip | choice |
      | groceries 84, $10 off coupon | choice |
      | paid 120 for groceries saved $5 | choice |
      | rent 1200 deposit 5 USD fee | choice |
      | coffee 4.50 and a 5 dollar tip | choice |
      | gift card $50 for 45 | choice |
      | seven eleven 4.50 | choice |
      | ten pin bowling 25 | choice |
      | three for two deal 12 | choice |
      | nine to five lunch 12 | choice |
      | forty winks coffee 4 | choice |
      | netflix 15.99 card 4008 | single |
      | $5 coffee for 2 people | single |
      | parking 3 hours 12 | single |

  Scenario Outline: A choice offers every plausible reading
    Then the choice offered for "<text>" is "<values>"

    Examples:
      | text               | values      |
      | dinner for 4 120   | 4120,4,120  |
      | dinner for 4, two hundred | 4,200 |
      | paid twenty for 2 tickets | 20,2  |
      | two fifty for 3 coffees | 250,2.5,3 |
      | uber 23 incl $3 tip | 23,3 |
      | 2 tickets @ 15     | 2,30,15     |

  Scenario: Over eight readings keeps the largest in reading order
    Then the choice offered for "paid 9 11 12 13 14 15 16 17 18 19 20" is "13,14,15,16,17,18,19,20"

  Scenario: Over eight readings keeps the money-marked ones first
    Then the choice offered for "paid $1 $2 $3 $4 $5 $6 $7 $8 $9 $10" is "3,4,5,6,7,8,9,10"

  Scenario: A very large number is not a candidate, so its label never uses exponent notation
    Then the amount plan for "coffee 99999999999999999999999" is "model"

  Scenario: Only eight candidates are offered as a choice
    Then the amount plan for a text with ten distinct amounts offers exactly 8

  Scenario: A single candidate is the amount whatever the model says
    When the model says transaction with amount "19" for "coffee 4.80"
    Then the parsed amount is 480

  Scenario: Several candidates: the model's pick from the set is used
    When the model says transaction with amount "9.6" for "paid 45 and then 9.60 for lunch"
    Then the parsed amount is 960

  Scenario: Several candidates: a pick outside the set gives no amount
    When the model says transaction with amount "12" for "paid 45 and then 9.60 for lunch"
    Then the parsed amount is none

  Scenario: No candidate: an amount invented for text with no number is dropped
    When the model says transaction with amount "19" for "lunch with the team"
    Then the parsed amount is none

  Scenario: No candidate: a number that is only a date is not accepted as the amount
    When the model says transaction with amount "5" for "lunch at the food court on the 5th"
    Then the parsed amount is none

  Scenario: No candidate: a spelled-out amount the extractor does not read is trusted
    When the model says transaction with amount "200" for "a couple hundred for rent"
    Then the parsed amount is 20000

  Scenario: A not-a-transaction verdict gives no amount even with one candidate
    When the model refuses "should I buy the 80 dollar shoes" with amount "80"
    Then the parsed amount is none
    And the verdict is false

  Scenario: The code-read amount is scaled to the active currency
    When the model says transaction with amount "0" for "coffee 500" in currency "JPY"
    Then the parsed amount is 500

  Scenario: Thai digits and CJK numerals are not read, and the model's own number for them is dropped
    When the model says transaction with amount "50" for "coffee ๕๐"
    Then the parsed amount is none

  Scenario Outline: In model mode the model's number counts only if a spelled-out phrase says it
    When the model says transaction with amount "<said>" for "<text>"
    Then the parsed amount is <minor>

    Examples:
      | text                     | said | minor |
      | spent two hundred        | 200  | 20000 |
      | spent two hundred        | 150  | none  |
      | a couple hundred for rent | 200 | 20000 |
      | bought one coffee        | 3    | none  |
      | lunch with the team      | 19   | none  |

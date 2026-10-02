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

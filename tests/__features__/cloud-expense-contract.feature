Feature: The BYOK cloud expense contract is the on-device step-2/3 contract over the wire
  Package A, PR 2. src/features/ai/engines/shared.ts's EXPENSE_PARSE_CONTRACT
  runs buildFmParseInstructions (the refuse rule), buildCloudParsePrompt (the
  FM prompt plus today's date), the per-text fmParseSchemaFor schema and
  finishFmParse - so a cloud model refuses a question, plan, budget or IOU the
  way the on-device model does, picks the category from a closed list, and
  never reads the amount where code can. The one difference: text that names
  no date takes the cloud model's own date before today.

  Scenario: The cloud instructions and prompt carry the refuse rule and today's date
    When I build the cloud expense prompt for "coffee 5" on 2026-07-16
    Then the instructions should be the FM instructions
    And the prompt should start with "Today is 2026-07-16. Yesterday was 2026-07-15."
    And the prompt should end with the FM prompt for the same text
    And the prompt should not ask the model to propose a new category name

  Scenario Outline: The request schema name and tool name are unchanged, the schema follows the text
    When I build the cloud expense JSON schema through the contract for "<text>"
    Then the contract's amount field should be "<amount>"

    Examples:
      | text                            | amount |
      | coffee 5                        | absent |
      | paid 45 and then 9.60 for lunch | enum   |
      | lunch at the food court         | number |

  Scenario Outline: A cloud verdict is classified exactly like the on-device one
    Given a cloud model reply for "<text>" with isTransaction <verdict>
    When I normalize it through the cloud expense contract and classify it
    Then the classification should be "<kind>"

    Examples:
      | text                               | verdict | kind    |
      | coffee 5                           | true    | parsed  |
      | should I pay 50 for dinner         | false   | refused |
      | budget 400 for groceries next month | false   | refused |
      | lunch at Chipotle                  | true    | failed  |
      | what is my balance                 | false   | failed  |

  Scenario: Under forceExpense a cloud refusal is never a refusal
    Given a cloud model reply for "should I pay 50 for dinner" with isTransaction false
    When I normalize it through the cloud expense contract and classify it under forceExpense
    Then the classification should be "failed"

  Scenario Outline: The user's own words date the parse; else the cloud model's date; else today
    Given a cloud model reply for "<text>" dated "<modelDate>" on 2026-07-16
    When I normalize it through the cloud expense contract
    Then the parse should be dated "<expected>"

    Examples:
      | text                     | modelDate  | expected   |
      | coffee 5 yesterday       | 2026-07-16 | 2026-07-15 |
      | coffee 5                 | 2026-07-14 | 2026-07-14 |
      | coffee 5                 |            | 2026-07-16 |

  Scenario: The on-device tier still never takes the model's date
    Given a cloud model reply for "coffee 5" dated "2026-07-14" on 2026-07-16
    When I finish it as the on-device tier does
    Then the parse should be dated "2026-07-16"

  Scenario Outline: The cue gate the chat screen runs before any request refuses the same texts as on-device
    Then cueRefusal for "<text>" should be <result>

    Examples:
      | text                                | result  |
      | should I pay 50 for dinner          | a cue   |
      | I owe Priya 30                      | a cue   |
      | remind me to pay Priya 30           | a cue   |
      | budget 400 for groceries next month | a cue   |
      | coffee 5                            | nothing |
      | should I pay for dinner             | nothing |

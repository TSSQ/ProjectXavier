Feature: On-device (Foundation Models) parse prompt, separate from the BYOK prompt
  The FM tier has its own instructions, user-turn prompt and schema descriptions
  (step 2 prompt tuning). The shared BYOK prompt in deviceParsePrompt.ts is left
  alone, so Haiku stays a fixed reference. These scenarios pin the FM-only rules.

  Scenario: The FM instructions refuse questions, plans, budgets and debts even with an amount
    When I build the FM parse instructions
    Then the FM instructions should mention "ALREADY moved"
    And the FM instructions should mention "a question, a plan or future payment"
    And the FM instructions should mention "a debt (who owes whom)"
    And the FM instructions should mention "even if it contains a number"
    And the FM instructions should mention "Never output an amount that is not written in the text"

  Scenario: The FM instructions and schema give no example amount to copy
    When I collect every FM instruction and schema description
    Then none of them should contain a digit from 2 to 9

  Scenario: The FM prompt lists the categories as one flat list and repeats the log or refuse rule
    Given FM existing categories:
      | name    | kind    |
      | Dining  | expense |
      | Salary  | income  |
    When I build the FM parse prompt for "paid 20" at time 1735689600000
    Then the FM prompt should mention "Known categories: Dining, Salary."
    And the FM prompt should mention "gets amount 0, even with a number in it"
    And the FM prompt should end with "Text: paid 20"

  Scenario: The FM prompt has no category, payee or account hints when none exist
    When I build the FM parse prompt for "coffee" at time 1735689600000
    Then the FM prompt should not mention "Known categories"
    And the FM prompt should not mention "Known payees"
    And the FM prompt should not mention "Known accounts"

  Scenario: The FM schema asks for a category from the list or an empty string
    When I read the FM schema category description
    Then the FM category description should mention "category list in the prompt"
    And the FM category description should mention "\"\" if none is related"

  Scenario: The FM schema has the same fields and required set as the shared schema
    When I compare the FM schema with the shared device parse schema
    Then both schemas should have the same field names
    And both schemas should require the same fields

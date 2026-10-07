Feature: The recording mappers fill the stored payloads
  What the Assistant is showing maps to a chat-log message that passes the same
  zod schema the repository enforces on write. A card whose state cannot fill a
  required field is skipped rather than invented
  (docs/design/xavier-daily-chat-spec.md section 5).

  Scenario Outline: Each card kind maps to a schema-valid message
    Then the "<card>" mapping should pass the chat message schema as kind "<kind>"

    Examples:
      | card                 | kind            |
      | draft                | draft           |
      | transfer draft       | draft           |
      | account create       | account_create  |
      | account update       | account_update  |
      | delete handoff       | delete_handoff  |
      | tx picker            | tx_picker       |
      | statement queue      | statement_queue |
      | afford               | afford          |
      | afford pick          | afford_pick     |
      | set budget           | set_budget      |
      | set budget (edit)    | set_budget      |
      | remove budget        | set_budget      |
      | create category      | set_budget      |
      | suggest set          | set_budget      |
      | suggest edit by      | set_budget      |
      | suggest remove       | set_budget      |

  Scenario Outline: Every query tool's answer maps to a schema-valid message
    Then the "<tool>" answer should pass the chat message schema

    Examples:
      | tool                 |
      | total_spent          |
      | total_income         |
      | spending_by_category |
      | spending_over_time   |
      | top_payees           |
      | net_worth            |
      | search_transactions  |

  Scenario: Bubbles map to text and receipts
    Then a text bubble, a saved receipt and a budget receipt all pass the schema, and a logged receipt is marked

  Scenario: A statement row receipt counts as logged
    Then the queue row receipt passes the schema and is marked logged

  Scenario: A photo records its label and nothing else
    Then the photo body holds only a label

  Scenario: State that cannot fill a payload is skipped
    Then a draft on an unknown account, "Open Budget" and "no budgets yet" map to nothing

  Scenario: An invalid query result is refused by the schema, not stored
    Then a query answer whose result has the wrong shape fails the chat message schema

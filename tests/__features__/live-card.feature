Feature: There is only ever one live card
  The screen holds each card flow in its own state; liveCardOf collapses them
  into one answer (docs/design/xavier-daily-chat-spec.md section 6.2).

  Scenario: Nothing set means no live card
    When no flow is set
    Then there should be no live card

  Scenario Outline: A single flow is the live card
    When only the <flow> flow is set
    Then the live card should be <flow>

    Examples:
      | flow           |
      | draft          |
      | account_create |
      | account_update |
      | delete_handoff |
      | query_answer   |
      | tx_picker      |

  Scenario: A budget reply is live only when the log stores it
    When a budget reply is set that is stored
    Then the live card should be budget
    When a budget reply is set that is not stored
    Then there should be no live card

  Scenario: The tx picker stays live through its account question
    When a tx picker is set
    Then the live card should be tx_picker

  Scenario: Two flows set at once pick one by precedence and are reported
    When a query answer and an account create are both set
    Then the live card should be account_create
    And the problem should say live_card_many

  Scenario: The log's newest live card must be of the screen card's kind
    When a draft is set and the log's newest live card is an account_create
    Then the problem should say live_card_kind_mismatch
    When a draft is set and the log's newest live card is a statement_queue
    Then there should be no problem

  Scenario: A live card the screen is not showing is reported
    When no flow is set and the log's newest live card is a draft
    Then the problem should say live_card_log_only

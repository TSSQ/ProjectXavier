Feature: The chat log reducer
  Today's conversation is an ordered list of messages with statuses. Only the
  newest card is interactive; a card resolves into its receipt, collapses to a
  dashed stub when abandoned or out of date, and a query answer stays as
  history (docs/design/xavier-daily-chat-spec.md section 6.2).

  Scenario: Messages append in order with a sequence per day
    Given an empty chat
    When the user says something, Xavier replies and a receipt follows
    Then the log should read user, xavier text, receipt with seq 1, 2, 3

  Scenario: Resolving a card hides it and appends its receipt
    Given an empty chat
    When a draft card appears and is resolved with a receipt
    Then the draft should be hidden and the receipt should follow it
    And nothing should be interactive

  Scenario: A new user message abandons the live card into a stub
    Given an empty chat
    When a draft card appears and the user sends another message
    Then the draft should show the stub "Expense · not saved"

  Scenario: A revision change marks the matching cards stale
    Given an empty chat
    When a set-budget card built at revision 3 sits live and the revision moves to 4
    Then the card should show the stub "Budget change · not made · out of date"

  Scenario: A revision change leaves cards the screen does not drop
    Given an empty chat
    When a draft card built at revision 3 sits live and the budget-card revision check runs for 4
    Then the draft should still be live

  Scenario: Only the newest card is interactive
    Given an empty chat
    When a pick card and then an afford card appear
    Then only the afford card should be interactive
    And the pick card should show the stub "Budget check · no budget chosen"

  Scenario: A query answer stays as history and is interactive only while newest
    Given an empty chat
    When a query answer appears and the user asks something else
    Then the answer should be read-only and not interactive
    And it should have no stub

  Scenario: A newest query answer can be dismissed
    Given an empty chat
    When a query answer appears
    Then it should be live and interactive

  Scenario Outline: Stub wording per card kind
    Then the "<kind>" card abandoned reads "<stub>" and stale reads "<stub> · out of date"

    Examples:
      | kind            | stub                              |
      | draft           | Expense · not saved               |
      | account_create  | Account "Trip" · not created      |
      | account_update  | Account "Cash" · not changed      |
      | afford          | Budget check · no action taken    |
      | afford_pick     | Budget check · no budget chosen   |
      | set_budget      | Budget change · not made          |
      | delete_handoff  | Delete · cancelled                |
      | tx_picker       | Transactions · nothing deleted    |
      | statement_queue | Statement · 5 of 8 saved          |

  Scenario: Other drafts and pickers have their own words
    Then an income draft reads "Income · not saved", a transfer draft "Transfer · not saved" and an update picker "Transactions · nothing changed"
    And a query answer and plain messages never stub

  Scenario: Dismissing a card stubs it and appends Xavier's line
    Given an empty chat
    When a draft card appears and is dismissed
    Then the draft should show the stub "Expense · not saved"
    And Xavier should say "No problem, I didn't save it."

  Scenario: Dismissing an account update says it was left as it was
    Given an empty chat
    When an account update card appears and is dismissed
    Then Xavier should say "No problem, I left it as it was."

  Scenario: A stale-draft explanation stubs the card as out of date
    Given an empty chat
    When a draft card appears and is expired
    Then the draft should show the stub "Expense · not saved · out of date"

  Scenario: The last-resort abandon stubs every live card and never resolves
    Given an empty chat
    When a draft card appears and the screen abandons its live cards
    Then the draft should show the stub "Expense · not saved"

  Scenario: Dismissing a query answer is not a discard
    Given an empty chat
    When a query answer appears and is dismissed
    Then it should be read-only with no stub and no line appended

  Scenario: A receipt is appended even when its card had already ended
    Given an empty chat
    When a draft card is abandoned by a new message and then its save is resolved with a receipt
    Then the receipt should still follow

  Scenario: A live card reloaded at the same revision is a stub, not interactive
    When today's stored log with a live draft at revision 5 loads at revision 5
    Then the draft should show the stub "Expense · not saved"
    And nothing should be interactive

  Scenario: A live card reloaded at a newer revision is stale
    When today's stored log with a live draft at revision 5 loads at revision 6
    Then the draft should show the stub "Expense · not saved · out of date"

  Scenario: A stored live query answer reloads as read-only history
    When today's stored log with a live query answer loads
    Then the answer should be read-only and nothing should be interactive

  Scenario: Nothing reloads as interactive
    When a stored log with two live cards loads at their revision
    Then no card should be live

  Scenario: An unstored tail makes every stored card non-interactive
    Given an empty chat
    When a draft card appears and a tail is active
    Then the draft should not be interactive and should be read-only

  Scenario: A statement queue is one live card that ends in its summary
    Given an empty chat
    When a queue card appears, two rows are confirmed, and it finishes with a summary
    Then the queue should be hidden, two receipts and the summary should follow, and nothing is interactive

  Scenario: Leaving a statement queue midway leaves a stub
    Given an empty chat
    When a queue card appears, advances to 2 of 8 saved, and the user sends another message
    Then the queue should show the stub "Statement · 2 of 8 saved"

  Scenario: The account Q&A is bubbles in turn
    Given an empty chat
    When Xavier asks a question and the user answers
    Then the log should read xavier text then user text

  Scenario: The header counts only transactions saved from the chat today
    Given a chat with saves for today, for yesterday and non-saves
    Then the count for today should be 3

  Scenario: An edit to a live card updates its payload and revision
    Given an empty chat
    When a draft card is edited
    Then its payload and revision should change and the diff should say so

  Scenario: The diff names what to write
    Given an empty chat
    When a card is added and later resolved
    Then the diff should list one added message and then one status change

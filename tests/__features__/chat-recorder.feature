Feature: The chat recorder sequences what the screen reports
  The screen names each card explicitly when it shows it, resolves it, expires
  it or dismisses it; the recorder keeps order, waits for the day to load, fixes
  the session day, and never throws
  (docs/design/xavier-daily-chat-spec.md sections 6.1 and 6.2).

  Scenario: Two drafts in a row are two cards
    Given a loaded recorder
    When a draft is shown, the user sends another message, and a second draft is shown
    Then the first draft should be a stub and the second should be live and interactive

  Scenario: Two query answers in a row are two cards
    Given a loaded recorder
    When a query answer is shown, the user asks again, and a second answer is shown
    Then both answers should be in the log and only the second should be interactive

  Scenario: An afford card after an afford card is a new card
    Given a loaded recorder
    When an afford card is shown and resolved by a pick, and another afford card is shown
    Then there should be two afford cards, the first hidden and the second live

  Scenario: A set-budget card after a set-budget card is a new card
    Given a loaded recorder
    When a set-budget card is shown and another set-budget card is shown with no message between
    Then the first should be a stub and the second live

  Scenario: A confirmed tx_picker delete stays resolved after the revision moves
    Given a loaded recorder
    When a tx_picker built at revision 3 is shown, resolved by its delete, and then the revision moves to 4
    Then the picker should be resolved, not stale

  Scenario: A tx_picker nobody confirmed goes stale when the revision moves
    Given a loaded recorder
    When a tx_picker built at revision 3 is shown and the revision moves to 4
    Then the picker should show the stub "Transactions · nothing deleted · out of date"

  Scenario: Picking a row for an update leaves the picker live until the edit is saved
    Given a loaded recorder
    When an update tx_picker is shown, a row is picked, and the edit is saved
    Then the picker should be live after the pick and hidden after the save

  Scenario: Walking away from the update editor stubs the picker
    Given a loaded recorder
    When an update tx_picker is shown, a row is picked, and the editor is closed
    Then the picker should show the stub "Transactions · nothing changed" with no line

  Scenario: An update whose row vanished expires the picker
    Given a loaded recorder
    When an update tx_picker is shown and the row is gone at save time
    Then the picker should show the stub "Transactions · nothing changed · out of date"

  Scenario: Narrowing the picker by account updates the same card
    Given a loaded recorder
    When a tx_picker is shown and then narrowed to one row
    Then there should be one picker card holding one row

  Scenario: A stale-draft explanation leaves a stub that says out of date
    Given a loaded recorder
    When a draft is shown and the stale-draft explanation expires it
    Then the draft should show the stub "Expense · not saved · out of date" and not be hidden

  Scenario: Every kind of chat save is counted
    Given a loaded recorder
    When a receipt save, a series save, a plain Saved. save and a skipped-on-screen save are recorded as logged, with an edit, an account create and a budget change
    Then the header count should be 4

  Scenario: A dismiss before load gives exactly one line
    Given a recorder that has not loaded yet
    When a draft is shown and dismissed before the load lands, and then the load lands
    Then the log should hold the draft stub followed by exactly one "No problem, I didn't save it." line

  Scenario Outline: Where the screen shows no line, none is recorded
    Given a loaded recorder
    When a "<kind>" card is shown and dismissed with no line
    Then it should be a stub and no line should follow

    Examples:
      | kind           |
      | delete_handoff |
      | tx_picker      |
      | set_budget     |
      | afford         |
      | afford_pick    |

  Scenario Outline: Where the screen says "No problem", the log records it once
    Given a loaded recorder
    When a "<kind>" card is shown and dismissed with the line
    Then it should be a stub and exactly one "No problem, I didn't save it." line should follow

    Examples:
      | kind           |
      | account_create |
      | draft          |

  Scenario: Cancelling the account Q&A before any card exists still records the line
    Given a loaded recorder
    When the account Q&A is cancelled with no card on screen
    Then exactly one "No problem, I didn't save it." line should be recorded

  Scenario: A failed confirm that keeps its card leaves it live
    Given a loaded recorder
    When a set-budget card is shown and its confirm fails with the card kept
    Then the card should still be live and interactive

  Scenario: A failed confirm that clears the card abandons it with no line
    Given a loaded recorder
    When a set-budget card is shown and its confirm fails with the card cleared
    Then it should be a stub and no line should follow

  Scenario: One stale row skipped leaves the queue live
    Given a loaded recorder
    When a queue is shown and one row is skipped as stale and the queue advances
    Then the queue should still be live, now counting the skipped row

  Scenario: A query answer's dismiss appends no line
    Given a loaded recorder
    When a query answer is shown and dismissed
    Then it should stay as read-only history and no line should follow

  Scenario: A chip tap is a user bubble
    Given a loaded recorder
    When Xavier asks which kind of account and the user taps a chip
    Then the log should read xavier text then user text

  Scenario: A statement queue stopped midway ends resolved with its summary
    Given a loaded recorder
    When a queue is shown, two rows are confirmed, and the review is stopped
    Then the queue should be hidden, followed by two logged receipts and the summary

  Scenario: A statement queue left by a new message ends as a stub
    Given a loaded recorder
    When a queue is shown, one row is confirmed, and the user sends another message
    Then the queue should show the stub "Statement · 1 of 8 saved"

  Scenario: Calls made before the load keep their order and ids
    Given a recorder that has not loaded yet
    When the user speaks, a card is shown and Xavier answers before the load lands
    Then nothing should be written yet, and after the load they appear in order with the returned card id

  Scenario: Stored rows reload with nothing interactive
    Given a recorder that has not loaded yet
    When a stored day with a live draft at the current revision and a live query answer loads
    Then the draft should be a stub, the answer read-only, and nothing interactive

  Scenario: The session day key survives midnight
    Given a recorder whose session started at 23:50
    When messages are recorded before and after midnight
    Then every message carries the session's day and the saves all count for it

  Scenario: Reset starts a fresh day
    Given a loaded recorder
    When messages are recorded, the chat is reset for a new day, and a message follows
    Then only the new message should remain, on the new day, with seq 1

  Scenario: The day key passed to load is the one used even when the clock moved on
    Given a recorder that has not loaded yet
    When load is given the day "2026-10-05" while the clock already reads the next day
    Then messages carry "2026-10-05"

  Scenario: The idle greeting is never recorded
    Given a loaded recorder
    When Xavier says the idle greeting
    Then nothing should be recorded

  Scenario: A failing reducer or writer never throws into the caller
    Given a recorder whose persistence throws
    When the user sends a message
    Then the call should not throw and the code "chat_reduce_failed" should be reported

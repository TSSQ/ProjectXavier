Feature: The chat session controller orders checks, writes and resets
  The controller (src/domain/chatSession.ts) runs against an in-memory database in
  plain Node. A day check and every message write share one chain, a clear of the
  day voids writes queued before it, and nothing stale-keyed survives it
  (docs/design/xavier-daily-chat-spec.md sections 6.1 and 8).

  Scenario: A cold launch on a new day clears the old chat and arms the note
    Given a database holding yesterday's chat
    When the screen starts today
    Then the log should be empty and loaded, the database empty, and the note armed

  Scenario: A cold launch on the same day keeps the chat and shows no note
    Given a database holding today's chat
    When the screen starts today
    Then the log should hold today's messages and the note should be off

  Scenario: A remount reads the armed note back from the stored flag
    Given a database holding yesterday's chat
    When the screen starts today
    And the screen is closed and started again the same launch
    Then the note should be armed and the check should have run once

  Scenario: A cold-launch check that throws is retried once the day has loaded
    Given a database holding yesterday's chat whose first check throws
    When the screen starts today
    Then the day should have loaded, a failure should be logged, the check should have run twice, and the chat should be cleared

  Scenario: A check that keeps failing is retried on the next resume
    Given a database holding yesterday's chat whose first two checks throw
    When the screen starts today
    And the app goes to the background and returns
    Then the check should have run three times and the launch check should be done

  Scenario: A resume across midnight resets behind a held feed
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the app goes to the background and returns
    Then the feed should have been held during the check and released after
    And the log should be empty, the database empty, the note armed and the layout reset once

  Scenario: An ordinary same-day resume never holds the feed
    Given a screen that started on the 5th with a chat
    When the app goes to the background and returns
    Then the feed should never have been held and nothing should have been cleared

  Scenario: A message sent while the check is in flight survives under the new day
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th, the app returns, and a message is sent while the check is still running
    And the check completes
    Then the database should hold only that message, under the day "2026-10-06", and the log should show it

  Scenario: No row survives a restore, even one whose write was blocked behind it
    Given a screen that started on the 5th with an empty chat
    When two messages are sent while the first write is still running and a restore completes
    Then the database should be empty and the log should be empty

  Scenario: Resetting while a parse is running fences it until it finishes
    Given a screen that started on the 5th with a chat and a parse running
    When the clock moves to the 6th and the app goes to the background and returns
    Then the late result should be dropped
    When the parse finishes and a message is sent
    Then the database should hold only that message, under the day "2026-10-06"

  Scenario: A restore while a parse is running fences it and disarms the note
    Given a screen that started on the 6th after a reset with a parse running
    When a restore completes
    Then the late result should be dropped, the note should be off and the layout reset

  Scenario: A resume that arrives before the day has loaded is checked once it has
    Given a database holding today's chat whose load is slow
    When the screen starts today and the app goes to the background and returns before the load lands
    And the load lands
    Then the check should have run twice

  Scenario: Two resumes in a row each get a check
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the app goes to the background and returns twice
    Then the check should have run three times and the layout should have reset once

  Scenario: An app switch before the first message disarms the note
    Given a database holding yesterday's chat
    When the screen starts today
    And the app goes to the background and returns
    Then the note should be off

  Scenario: An empty chat left open past midnight stamps the next message with the new day
    Given a screen that started on the 5th with an empty chat
    When the clock moves to the 6th, the app goes to the background and returns, and a message is sent
    Then the database should hold only that message, under the day "2026-10-06"

  Scenario: A session that crosses midnight keeps one day and is wiped on the next open
    Given a screen that started on the 5th at 23:50 with an empty chat
    When a message is sent, midnight passes, another message is sent, and the screen is reopened on the 6th
    Then both messages carried "2026-10-05" before the reopen
    And after the reopen the database should be empty and the note armed

  Scenario: A check that throws during a hold releases it and leaves the chat alone
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the next check throws and the app goes to the background and returns
    Then the feed should have been held then released and a failure logged
    And the log should be unchanged
    When a message is sent
    Then the message should be recorded after the old one

  Scenario: A parse result that lands during a hold stays out of the new day, but the user's send survives
    Given a screen that started on the 5th with a chat and a parse running
    When the clock moves to the 6th, the app returns, a parse result lands and the user sends a message during the check
    And the check completes
    Then the database should hold only the user's message, under the day "2026-10-06"

  Scenario: Two stale resumes back to back reset once and leave the note consistent
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the app goes to the background and returns twice
    Then the feed should end released, the layout should have reset once, and the shown note should match the stored one

  Scenario: A check that never answers releases the feed after the timeout, and still resets when it answers
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the check hangs and the app goes to the background and returns
    Then the feed should be held
    When the hold timeout fires
    Then the feed should be released and the slowness logged
    When the check finally answers
    Then the chat should be cleared and the layout reset once

  Scenario: Starting twice shares one load
    Given a database holding today's chat
    When the screen starts today twice
    Then the check should have run once and the day should be loaded

  Scenario: A reply that began before a reset can tell the day was cleared
    Given a screen that started on the 5th with a chat
    When a reply notes the day's reset count, then the clock moves to the 6th and the app returns
    Then the reset count should have moved before the reply lands

  Scenario: A send held through the check keeps its reply when the check resets
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the app returns, the user sends during the check, its parse starts and replies
    And the check completes
    Then the database should hold the user's message and Xavier's reply, both under the day "2026-10-06"

  Scenario: A remounted screen waits for the previous mount's in-flight write
    Given a screen that started on the 5th with an empty chat
    When a message write is in flight, the screen is closed, and a new screen starts on the shared chain
    And the write completes
    Then the new screen should load the written message

  Scenario: Closing the screen cancels a pending hold timeout
    Given a screen that started on the 5th with a chat
    When the clock moves to the 6th and the check hangs and the app goes to the background and returns
    And the screen is closed
    Then no hold timeout should be left pending

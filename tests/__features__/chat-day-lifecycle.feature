Feature: When the chat's day check runs, and what the hero says
  The check runs on a cold launch and when the app returns to the foreground
  after being left. It runs behind the lock cover (it only touches the database)
  and never on a timer (docs/design/xavier-daily-chat-spec.md sections 6.1 and 8).

  Scenario: Returning from the background runs one resume check
    Given a fresh check gate
    When the app goes to the background and becomes active again
    Then one resume check should run

  Scenario: The lock state does not matter and a resume runs exactly once
    Given a fresh check gate
    When the app goes to the background and becomes active again, then reports active twice more
    Then one resume check should run

  Scenario: The iOS inactive hops on the way do not hide the background visit
    Given a fresh check gate
    When the app goes inactive, to the background, inactive, then active
    Then one resume check should run

  Scenario: The Face ID sheet is only an inactive blip
    Given a fresh check gate
    When the app goes inactive and active again
    Then no check should run

  Scenario: Being active at the start is not a resume
    Given a fresh check gate
    When the app reports active before ever leaving
    Then no check should run

  Scenario: A session running past midnight is not checked without leaving the app
    Given a fresh check gate
    When time passes with no lifecycle event
    Then no check should run

  Scenario: Each resume runs its own check
    Given a fresh check gate
    When the app goes to the background and becomes active again
    And the app goes to the background and becomes active again
    Then two resume checks should have run

  Scenario: Every 23:30 to 00:30 resume crosses to the next local day, daylight saving included
    Then for every day of 2026 a resume from 23:30 to 00:30 sees the next local date

  Scenario: A day check whose note write fails still reports the clear
    Given a chat store holding yesterday's messages whose note cannot be written
    When the app cold-launches today after unlock
    Then the check should report a reset and the store should be empty

  Scenario: A day check whose clear fails reports the failure and leaves the note alone
    Given a chat store holding yesterday's messages that cannot be cleared
    When the app cold-launches today after unlock
    Then the check should fail and the notice should be off

  Scenario: The hero note is shown until the first message and cleared exactly once
    Given a day that reset with the note armed
    When the layout walks from loading through the first message to the header
    Then the note is shown in the hero and while moving, never in the header, and the stored note is cleared once on the first message

  Scenario: A disarmed note is never shown
    Given a day that reset with the note disarmed
    When the layout walks from loading through the first message to the header
    Then the note is never shown

  Scenario: A late result from a parse that was running at the reset is dropped
    Given a loaded recorder with a parse running
    When the chat resets for "2026-10-06" with that parse still running and its result arrives
    Then the new day should stay empty
    When the parse has finished and a new message is recorded
    Then only the new message should be on the new day

  Scenario: A reset with nothing running does not fence the log
    Given a loaded recorder with a parse running
    When the chat resets for "2026-10-06" with nothing running and a message is recorded
    Then only the new message should be on the new day

  Scenario: Calls made while a day check is held replay under the day it decided
    Given a loaded recorder holding yesterday's chat
    When the log is held, a message is recorded, the chat resets for "2026-10-06" and the hold is released
    Then only the new message should be on the new day

  Scenario: An empty chat left open past midnight adopts the new day
    Given a loaded recorder on "2026-10-05" with an empty chat
    When the day check finds nothing to clear on "2026-10-06" and a message follows
    Then the message should carry "2026-10-06"

  Scenario: A chat with messages keeps its day when nothing was cleared
    Given a loaded recorder on "2026-10-05" with one message
    When the day check finds nothing to clear on "2026-10-06" and a message follows
    Then both messages should carry "2026-10-05"

  Scenario: A restore signal reaches every listener until it is removed
    Given two listeners on the restore signal, one of which throws
    When a restore completes
    Then both listeners should have been called
    When the first listener is removed and another restore completes
    Then only the second listener should have been called again

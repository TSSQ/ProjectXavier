Feature: The chat clears itself on the first open of a new day
  The chat's day is the local calendar date. A reset is decided only on a cold
  launch, or on the app becoming active after being in the background, and only
  once the app is unlocked. Never on a timer
  (docs/design/xavier-daily-chat-spec.md section 6.1).

  Scenario: The day key is the local date, either side of midnight
    Then 2026-10-05 23:59 local is day "2026-10-05" and 2026-10-06 00:01 local is day "2026-10-06"

  Scenario: A cold launch on a new day resets
    When the app cold-launches at 2026-10-06 00:01 with the oldest stored message from "2026-10-05"
    Then the chat should reset for day "2026-10-06"

  Scenario: A cold launch on the same day does not reset
    When the app cold-launches at 2026-10-05 23:59 with the oldest stored message from "2026-10-05"
    Then the chat should not reset

  Scenario: Resuming from the background across midnight resets
    When the app becomes active from background at 2026-10-06 07:30 with the oldest stored message from "2026-10-05"
    Then the chat should reset for day "2026-10-06"

  Scenario: A session that runs past midnight does not reset
    Given a session that started on "2026-10-05"
    When midnight passes with only a timer tick and an inactive to active blip
    Then the chat should not reset

  Scenario: A locked app never resets
    When the app cold-launches at 2026-10-06 00:01 while locked with the oldest stored message from "2026-10-05"
    Then the chat should not reset

  Scenario: An empty chat never resets
    When the app cold-launches at 2026-10-06 00:01 with nothing stored
    Then the chat should not reset

  Scenario: The oldest stored day decides, so leftovers from a session past midnight reset
    When the app becomes active from background at 2026-10-06 00:20 with the oldest stored message from "2026-10-05"
    Then the chat should reset for day "2026-10-06"

  Scenario: Only a launch and a background resume are triggers
    Then the lifecycle triggers should be cold_launch, resume, and nothing for a timer or an inactive blip

  Scenario: A time zone change moves the day key with the clock
    When a message was stored under the date "2026-10-06" and the app cold-launches at the instant 2026-10-06T02:00:00Z in the device's zone
    Then the chat should reset exactly when the device's local date at that instant is not "2026-10-06"

  Scenario: Daylight saving never skips or repeats a day
    Then every half hour of each 2026 daylight-saving transition day in the running zone has a single day key, and the next day differs
    # The transition days are derived from the zone the suite runs in. In a
    # zone without daylight saving (the default UTC run) there are none, so this
    # only checks the offset never changes; `npm run test:tz` runs it in
    # America/New_York and Pacific/Auckland, where it crosses real transitions.

  Scenario: A reset arms the one-time note and a later open clears it
    Given a chat store holding yesterday's messages
    When the app cold-launches today after unlock
    Then the store should be empty and the notice should be on
    When the app becomes active from background the same day
    Then the notice should be off

  Scenario: The first message clears an armed note
    Given a chat store holding yesterday's messages
    When the app cold-launches today after unlock
    And the first message of the day is sent
    Then the notice should be off

  Scenario: The first message is a no-op when no note is armed
    Given a chat store with the notice off
    When the first message of the day is sent
    Then the notice should be off and nothing was written

  Scenario: A locked or timer check leaves an armed note alone
    Given a chat store holding yesterday's messages
    When the app cold-launches today after unlock
    And a locked resume and a timer tick happen the same day
    Then the notice should be on and nothing was written
    When the app becomes active from background the same day
    Then the notice should be off

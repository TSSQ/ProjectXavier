Feature: Chat messages are validated, parameterised, and kept out of backups
  The chat log is a table of zod-validated rows (guardrail 6) written and read
  with parameterised SQL (guardrail 4). It is stripped from the exported backup
  image, and a restore leaves it empty
  (docs/design/xavier-daily-chat-spec.md sections 5 and 7).

  Scenario: Every kind round-trips through the table
    Given a migrated database
    When I append one message of every kind and read them back
    Then every message should come back equal to what was written
    And every one of the 7 query tools and both net_worth shapes should be covered

  Scenario: A malformed row is skipped without throwing
    Given a migrated database holding one good message and these bad rows
      | what                       |
      | payload is not JSON        |
      | payload misses its fields  |
      | kind is unknown            |
      | role does not match kind   |
      | status is unknown          |
    When I read the day back
    Then only the good message should be returned and nothing should throw
    And the skip reasons should not contain any message content

  Scenario: An invalid message is refused on write without echoing content
    Given a migrated database
    When I append a draft whose amount is negative and whose note holds a secret
    Then the write should be rejected with "chat_invalid_write" and the table should stay empty

  Scenario: The day key must be a real calendar date
    Then day keys "2026-10-05" and "2024-02-29" are accepted and "2026-02-30", "2026-99-99" and "2025-02-29" are refused

  Scenario: Payload caps sit exactly at the domain's own limits
    Then series of MAX_SERIES_BUCKETS points are accepted and one more is refused
    And notes of the transaction note limit are accepted and one more is refused
    And the transaction schemas share that note limit

  Scenario: A photo message holds a label and no image
    Then the user_photo payload should reject any field other than a label

  Scenario: Sequence numbers count up per day
    Given a migrated database
    When I append two messages on one day and one on the next
    Then the sequence numbers should be 1, 2 and 1

  Scenario: Chat statements bind every value
    When I build the chat statements from values that look like SQL
    Then no statement should contain the value text
    And every statement should use bound parameters

  Scenario: The chat repository builds SQL only through the parameterised builders
    When I read the chat repository source
    Then it should contain no template-literal or concatenated SQL

  Scenario: The migration creates chat_messages and is safe to run twice
    Given an empty database
    When I run the migrations twice
    Then the chat_messages table should exist with its index
    And the migrations should not have thrown

  Scenario: The exported backup image has no chat rows
    Given a migrated database holding chat messages and a budget
    When I export it as a backup image and strip it as the export step does
    Then the image should hold no chat_messages rows and still hold the budget
    And the image file's raw bytes should not contain the chat marker
    And without the VACUUM the marker would still be in the file
    And the export step should VACUUM the image after the strip

  Scenario: Restore never reads or writes the chat table
    Then chat_messages should be in neither SQL_TABLES nor OPTIONAL_SQL_TABLES
    And the export step should strip it exactly as it strips parse_metrics

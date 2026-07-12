Feature: Backup gate — exclusive backup/restore serialisation
  A restore must never interleave with a backup snapshot (assessment H1).
  runExclusive serializes work FIFO so only one of them ever runs at a time.

  Scenario: Two enqueued tasks run FIFO and never overlap
    Given a slow first task and a fast second task queued through the gate
    When both are run through runExclusive
    Then the second task should not start until the first has resolved

  Scenario: A rejecting task propagates its error without wedging the chain
    Given a task that rejects
    And a second task queued after it
    When both are run through runExclusive
    Then the first caller should see the rejection
    And the second task should still run

  Scenario: The return value passes through
    Given a task that resolves with a value
    When it is run through runExclusive
    Then the caller should receive that value

  Scenario: A restore fully completes before a queued backup observes state
    Given a slow fake restore queued through the gate
    And a fake backup queued after it that records the state it observes
    When both are run through runExclusive
    Then the backup should only observe post-restore state

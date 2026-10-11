Feature: Serial queue — concurrent writers to one file take turns
  The corrections file (src/features/diagnostics/corrections.ts) appends one
  line per "This parse was wrong" save. Two saves in flight at once must not
  interleave their writes, so every append runs through one
  createSerialQueue() (src/domain/serialQueue.ts): FIFO, one at a time, and
  a failed write never blocks the next.

  Scenario: Overlapping jobs run one at a time, in the order they were queued
    Given a serial queue
    When three slow jobs "a", "b" and "c" are queued at once
    Then the jobs should have run in the order "a", "b", "c" without overlapping

  Scenario: A failed job rejects only its own caller and the next job still runs
    Given a serial queue
    When a job that fails is queued, then a job "after"
    Then the failing job's caller should see the failure
    And the job "after" should have run

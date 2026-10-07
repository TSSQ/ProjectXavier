Feature: The Budget month picker lists activity months plus the ones you can budget
  The Budget screens reuse the Dashboard's period sheet in month-only mode. It
  must offer every month with activity, plus the current month, the next month,
  the selected month and any month a stored budget starts or ends in - deduped
  and newest first. Months with neither activity nor budgets stay out.

  Scenario: A month key converts to its local start and back
    Then month "2026-10" should start at the local midnight of its first day and map back

  Scenario: The extra months are current, next and selected
    Then the extra months at October 2026 with "2026-03" selected should be "2026-10,2026-11,2026-03"

  Scenario: Months across a year boundary
    Then the extra months at December 2026 with "2026-12" selected should be "2026-12,2027-01"

  Scenario: A selected month equal to the current or next month is deduped
    Then the extra months at October 2026 with "2026-10" selected should be "2026-10,2026-11"
    And the extra months at October 2026 with "2026-11" selected should be "2026-10,2026-11"

  Scenario: Stored budget months are included, including ones set far ahead
    Then the extra months at October 2026 with "2026-10" selected and budgets "2026-01,2027-03:2027-05" should be "2026-10,2026-11,2026-01,2027-03,2027-05"

  Scenario: A malformed month key is rejected
    Then the extra months at October 2026 with "garbage" selected and budgets "2026-13" should be "2026-10,2026-11"

  Scenario: Activity and extra periods merge deduped and newest first
    Then merging activity "2026-08,2026-10,2024-01" with extras "2026-11,2026-10,2020-02,2026-08" should give "2026-11,2026-10,2026-08,2024-01,2020-02"

  Scenario: An injected current month has zero totals
    Then merging activity "2026-08" with extras "2026-10" should give "2026-10,2026-08" with "2026-10" empty

  Scenario: The category push carries the month
    Then app/budget.tsx should pass month in the category detail push

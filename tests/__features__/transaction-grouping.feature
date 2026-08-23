Feature: Grouping the ledger by day, with future-dated rows collected
  `groupTransactionsByDay` buckets the ledger into local calendar days,
  newest first. Future-dated transactions used to sit in their own day
  headings scattered above today ("AUG 25, 2026", "SEP 04, 2026"), which
  reads as history that has already happened. Passing `now` collects every
  future-dated row into a single leading "Upcoming" section instead.

  Sorting inside that section is deliberately the opposite of the rest of the
  ledger: past days run newest-first because you are looking back, upcoming
  runs soonest-first because you are looking forward.

  Scenario: Without a clock the grouping is unchanged
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-08-20 | Subway  |
      | 2026-08-25 | Netflix |
    When I group them without a clock
    Then the sections should be "Aug 25, 2026, Aug 20, 2026"

  Scenario: Future-dated rows collect into one Upcoming section
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-08-20 | Subway  |
      | 2026-08-25 | Netflix |
      | 2026-09-04 | ChatGPT |
    When I group them as of today
    Then the sections should be "Upcoming, Aug 20, 2026"
    And the Upcoming section should hold "Netflix, ChatGPT"

  Scenario: Upcoming runs soonest first
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-12-15 | Gym     |
      | 2026-08-25 | Netflix |
      | 2026-09-04 | ChatGPT |
    When I group them as of today
    Then the Upcoming section should hold "Netflix, ChatGPT, Gym"

  # Today is not upcoming — the day-granular rule, same as isUpcoming.
  Scenario: A transaction dated later today stays under today
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-08-23 | Lunch   |
    When I group them as of today
    Then the sections should be "Today"

  Scenario: With nothing upcoming there is no Upcoming section
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-08-20 | Subway  |
      | 2026-08-19 | Coffee  |
    When I group them as of today
    Then the sections should be "Aug 20, 2026, Aug 19, 2026"

  Scenario: Past days still run newest first
    Given today is "2026-08-23"
    And these transactions:
      | date       | payee   |
      | 2026-08-19 | Coffee  |
      | 2026-08-21 | Subway  |
      | 2026-08-25 | Netflix |
    When I group them as of today
    Then the sections should be "Upcoming, Aug 21, 2026, Aug 19, 2026"

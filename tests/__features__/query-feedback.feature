Feature: "Wrong answer" on an Ask-Xavier card corrects, records and teaches
  The user picks the right tool, period and category or payee
  (src/domain/queryFeedback.ts). The corrected call re-runs through the same
  executor, the change is recorded on the question's metrics row (dimension
  names only) and as a question correction on the device
  (src/domain/parseCorrection.ts), and a changed filter teaches the word.

  Background:
    Given the expense categories "Dining, Groceries"
    And the payees "McDonald's, NTUC FairPrice"
    And this month I spent 20.00 on Dining at McDonald's and 50.00 on Groceries at NTUC FairPrice
    And the question was total_spent this_month with category "food"

  Scenario: Only the period was wrong
    When I say the period should be "last_month"
    Then the wrong dimensions are "period"
    And the corrected call is total_spent last_month with category "food"

  Scenario: "Other" period keeps the period that ran and still counts as wrong
    When I say the period should be "other"
    Then the wrong dimensions are "period"
    And the corrected call is total_spent this_month with category "food"

  Scenario: Picking a category pins it by id and keeps the user's word
    When I say the category should be "Dining"
    Then the wrong dimensions are "filter"
    And the corrected call is total_spent this_month with category "food"
    And the corrected call pins category "Dining"
    And re-running it answers 20.00

  Scenario: Picking "None" clears the filter
    When I say there should be no filter
    Then the wrong dimensions are "filter"
    And the corrected call is total_spent this_month with no filter
    And re-running it answers 70.00

  Scenario: Switching tool keeps the period and drops a filter the tool cannot take
    When I say the tool should be "top_payees"
    Then the wrong dimensions are "tool"
    And the corrected call is top_payees this_month with no filter

  Scenario: Switching to net worth with a period asks for it as of that period
    When I say the tool should be "net_worth" and the period "last_month"
    Then the wrong dimensions are "tool,period"
    And the corrected call is net_worth as of last_month

  Scenario: Choosing what already ran is not a change
    When I say the period should be "this_month"
    Then the wrong dimensions are ""

  Scenario: The answer's figure is read per tool
    Then the figure of a total_spent of 70.00 is 70.00 with no items
    And the figure of a top_payees list of 50.00 and 20.00 is 70.00 over 2 items
    And the figure of a net_worth trend ending at 900.00 is 900.00 over 3 items
    And the figure of a search_transactions list of 2 rows has no amount over 2 items

  Scenario: Switching to net worth keeps the period that ran
    Given the question was total_spent last_month with no filter
    When I say the tool should be "net_worth"
    Then the corrected call is net_worth as of last_month

  Scenario: A net worth trend without a period ran over last year
    Then a net_worth trend with no period ran for "last_year"

  Scenario: Re-picking the parent category that ran is not a change
    Given the expense category "Coffee" under "Dining"
    And the question was total_spent this_month with category "Dining"
    When I say the category should be "Dining"
    Then the wrong dimensions are ""

  Scenario: A second mark adds its dimensions to the first
    Then merging "tool" with "period" gives "tool,period"
    And merging "filter" with "filter" gives "filter"

  Scenario: A question correction is a valid line the fold script refuses to fold as a transaction case
    When I say the category should be "Dining"
    And I build the question correction
    Then it validates with the id prefix "dv-uq-"
    And its expect block reads tool "total_spent", period "this_month", category "Dining"
    And its answer went from 70.00 to 20.00
    And reading the corrections file back returns it as a question, not a transaction case
    And the fold script refuses a file holding it, naming it a question correction

  Scenario: A malformed question correction never reaches the file
    Then a question correction with an unknown tool is rejected

  Scenario: Metrics count questions marked wrong per engine and dimension
    Given metrics rows: on_device answered 3 questions, one marked wrong with "tool,period", one with "filter"
    Then the on_device questions block reads 3 questions, 2 wrong, tool 1, period 1, filter 1

  Scenario: The metrics column for the mark is migrated additively
    Given a database migrated before the wrong_dims column existed
    When the migrations run twice
    Then parse_metrics has a wrong_dims column

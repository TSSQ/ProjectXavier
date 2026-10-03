Feature: Budget math — spent, scheduled, left, pace and state
  The pure maths behind the dashboard card and the Budget screen
  (docs/design/monthly-budgets-spec.md section 4), pinned with the approved
  mockup's October numbers.

  Scenario: The mockup's October fixture reproduces every figure
    Given the mockup fixture on October 18
    When I compute the October budgets
    Then 663 should be left of 2100 budgeted
    And spent should be 1287 and scheduled 150
    And the overall chip should read "A little ahead of pace"
    And per day should be 51 with 13 days left
    And Today's tick should sit at 64.5 percent
    And Entertainment should be over by 21
    And Dining should be warn
    And these should be ok:
      | Shopping  |
      | Groceries |
      | Transport |
      | Health    |
      | Bills     |
    And the dashboard's worst 3 should be "Entertainment, Dining, Shopping"
    And the dashboard footer should read "+ 4 more on track"
    And the Budget screen order should be "Entertainment, Dining, Shopping, Groceries, Bills, Transport, Health"
    And Not budgeted should be "Gifts 45"
    And Bills should have 172 paid, 150 scheduled and fixed 322

  Scenario: The mockup copy is produced by the templates
    Given the mockup fixture on October 18
    When I compute the October budgets
    Then the headline copy should be "$663 left of $2,100"
    And the legend should read "Spent $1,287" and "Scheduled $150"
    And the pace line should read "13 days left · about $51/day"
    And Entertainment's row should read "$21 over"
    And Dining's row should read "$188 left"
    And Bills' detail line should read "$172 paid · $150 scheduled · of $350"

  Scenario: A recurring occurrence already posted today is counted once, as spent
    Given a monthly Bills series of 50 due on the 22nd
    And today is October 22
    And the October 22 occurrence has already been posted
    When I compute the Bills budget of 350 for October
    Then Bills should show 50 spent and 0 scheduled

  Scenario: The same occurrence not yet posted counts as scheduled
    Given a monthly Bills series of 50 due on the 22nd
    And today is October 22
    When I compute the Bills budget of 350 for October
    Then Bills should show 0 spent and 50 scheduled

  Scenario: A skipped date is not counted at all
    Given a monthly Bills series of 50 due on the 22nd
    And today is October 18
    And the October 22 occurrence is skipped
    When I compute the Bills budget of 350 for October
    Then Bills should show 0 spent and 0 scheduled

  Scenario: A paused series is not counted
    Given a monthly Bills series of 50 due on the 22nd
    And today is October 18
    And the series is paused
    When I compute the Bills budget of 350 for October
    Then Bills should show 0 spent and 0 scheduled

  Scenario: A pending expense is scheduled until it is un-pended
    Given today is October 18
    And a pending Bills expense of 80 dated October 10
    When I compute the Bills budget of 350 for October
    Then Bills should show 0 spent and 80 scheduled

  Scenario: Transfers and income never count
    Given today is October 18
    And a Dining expense of 30 on October 5
    And a transfer of 100 filed under Dining on October 6
    And an income of 500 filed under Salary on October 7
    When I compute the Dining budget of 500 for October
    Then Dining should show 30 spent and 0 scheduled

  Scenario: A refund reduces the category's spend
    Given today is October 18
    And a Dining expense of 50 on October 5
    And a Dining refund of 20 on October 6
    When I compute the Dining budget of 500 for October
    Then Dining should show 30 spent and 0 scheduled

  Scenario: A child category rolls up into its parent
    Given today is October 18
    And a Dining expense of 30 on October 5
    And a Takeout expense of 20 on October 6, where Takeout is a child of Dining
    When I compute the Dining budget of 500 for October
    Then Dining should show 50 spent and 0 scheduled

  Scenario: An archived account's expense counts
    Given today is October 18
    And a Dining expense of 40 on October 5 on an archived account
    When I compute the Dining budget of 500 for October
    Then Dining should show 40 spent and 0 scheduled

  Scenario: A bill paid on the 1st does not push the category to warn
    Given today is October 2
    And a Bills expense of 322 posted from a recurring series on October 1
    When I compute the Bills budget of 350 for October
    Then Bills should be ok

  Scenario Outline: Days left and per-day follow the calendar
    Given today is <today>
    When I compute a 3000 total budget with nothing spent
    Then days left should be <days> and per-day should be <perDay>

    Examples:
      | today      | days | perDay |
      | October 1  | 30   | $100   |
      | October 18 | 13   | $231   |
      | October 30 | 1    | $3,000 |
      | October 31 | 0    | none   |

  Scenario: Last day shows no per-day figure, and an empty budget hides it
    Given today is October 31
    When I compute a 3000 total budget with nothing spent
    Then the pace line should read "Last day"

  Scenario: A past month shows no tick, chip or per-day figure
    Given the mockup fixture on October 18
    When I compute the September budgets
    Then there should be no tick, chip, days left or per-day figure

  Scenario: A future month has nothing spent
    Given the mockup fixture on October 18
    When I compute the November budgets
    Then spent should be 0 and the recurring Bills should be scheduled

  Scenario: A budget made entirely of bills has nothing left and is not NaN
    Given today is October 18
    And a Bills expense of 350 posted from a recurring series on October 1
    When I compute the Bills budget of 350 for October
    Then Bills should be ok with 0 left and finite figures

  Scenario: Bills beyond the budget are over and the flexible test is skipped
    Given today is October 18
    And a Bills expense of 400 posted from a recurring series on October 1
    When I compute the Bills budget of 350 for October
    Then Bills should be over by 50

  Scenario Outline: The overall chip at the edge of the ten percent band
    Given today is November 15
    And a Dining expense of <spent> on November 2
    When I compute the Dining budget of 1000 for November
    Then the overall chip should read "<chip>"

    Examples:
      | spent  | chip                   |
      | 600.00 | A little ahead of pace |
      | 600.01 | Ahead of pace          |
      | 500.00 | On pace                |

  Scenario: An over-budget month mid-way shows no per-day figure
    Given today is October 18
    And a Dining expense of 1200 on October 5
    When I compute the Dining budget of 1000 for October
    Then per-day should be hidden with 13 days left and the pace line "13 days left"

  Scenario: Spent never goes below zero
    Given today is October 18
    And a Dining expense of 50 on October 5
    And a Dining refund of 80 on October 6
    When I compute the Dining budget of 500 for October
    Then Dining should show 0 spent and 0 scheduled
    And Dining should have the whole 500 left

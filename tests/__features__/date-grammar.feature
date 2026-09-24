Feature: One date grammar for date headers and printed dates

  The format inventory for src/domain/dateGrammar.ts. The same grammar
  answers both questions the app asks about a printed date: is this LINE a
  date header (statementLayout.ts, isDateOnlyLine), and which DAY does this
  text mean (deviceParsePrompt.ts, resolveAbsoluteDate). They used to be two
  regex sets that drifted apart. To support a new format, add a row here.

  The clock reads Thursday 24 September 2026, 10:00 local, so a date with no
  printed year means 2026.

  Scenario Outline: A printed date is a date header and resolves to its day
    Then "<text>" should be a date header
    And "<text>" should resolve to <date>

    Examples:
      | text                          | date       |
      | 16/09/2026                    | 2026-09-16 |
      | 16/9/2026                     | 2026-09-16 |
      | 16/09/26                      | 2026-09-16 |
      | 16-09-2026                    | 2026-09-16 |
      | 16.09.2026                    | 2026-09-16 |
      | 24.09.26                      | 2026-09-24 |
      | 16/09                         | 2026-09-16 |
      | 09/16/2026                    | 2026-09-16 |
      | 1/2/2026                      | 2026-02-01 |
      | 2026-09-16                    | 2026-09-16 |
      | 2026/09/16                    | 2026-09-16 |
      | 2025-09-16                    | 2025-09-16 |
      | 16 Sep 2026                   | 2026-09-16 |
      | 16 Sept 2026                  | 2026-09-16 |
      | 16 SEPT 2026                  | 2026-09-16 |
      | 16 September 2026             | 2026-09-16 |
      | 16 SEP 2026                   | 2026-09-16 |
      | 16 sep                        | 2026-09-16 |
      | 16 Sep                        | 2026-09-16 |
      | 2 Sep                         | 2026-09-02 |
      | 02 Sep 2026                   | 2026-09-02 |
      | 16 Sep, 2026                  | 2026-09-16 |
      | 16 Sep. 2026                  | 2026-09-16 |
      | 16th September 2026           | 2026-09-16 |
      | 1st Sep                       | 2026-09-01 |
      | 16 of September 2026          | 2026-09-16 |
      | 1 Jan 2026                    | 2026-01-01 |
      | 31 Dec 2025                   | 2025-12-31 |
      | 16-Sep-2026                   | 2026-09-16 |
      | 16-SEP-26                     | 2026-09-16 |
      | 16-Sep                        | 2026-09-16 |
      | 16Sep2026                     | 2026-09-16 |
      | 16SEP26                       | 2026-09-16 |
      | Sep 16, 2026                  | 2026-09-16 |
      | Sep 16 2026                   | 2026-09-16 |
      | SEP 16 2026                   | 2026-09-16 |
      | September 16, 2026            | 2026-09-16 |
      | Sep 16                        | 2026-09-16 |
      | Sept 16                       | 2026-09-16 |
      | Sept. 16                      | 2026-09-16 |
      | Sep. 16, 2026                 | 2026-09-16 |
      | Sep 1st, 2026                 | 2026-09-01 |
      | Wed, 16 Sep 2026              | 2026-09-16 |
      | Wednesday 16 September 2026   | 2026-09-16 |
      | Wed 16 Sep                    | 2026-09-16 |
      | Mon 1 Sep                     | 2026-09-01 |
      | Wed, Sep 16, 2026             | 2026-09-16 |
      | Thursday, September 24, 2026  | 2026-09-24 |
      | Thu 24/09/2026                | 2026-09-24 |
      | 24/09/2026 (Thu)              | 2026-09-24 |
      | 16/09/2026 13:12:18           | 2026-09-16 |
      | 16-09-2026 13:12:18           | 2026-09-16 |
      | 16/09/2026, 13:12             | 2026-09-16 |
      | 16/09/2026 1:12 p.m.          | 2026-09-16 |
      | 16 Sep 2026, 1:12 PM          | 2026-09-16 |
      | 16 Sep 2026 1:12pm            | 2026-09-16 |
      | 16 Sep 2026 13:12             | 2026-09-16 |
      | 16 Sep 2026 13:12 SGT         | 2026-09-16 |
      | 16 Sep 2026 13:12 GMT+8       | 2026-09-16 |
      | Sep 16, 2026 at 1:12 PM       | 2026-09-16 |
      | 2026-09-16 13:12:18           | 2026-09-16 |
      | 2026-09-16T13:12:18           | 2026-09-16 |
      | 2026-09-16T13:12:18Z          | 2026-09-16 |
      | 2026-09-16T13:12:18+08:00     | 2026-09-16 |
      | 23 Sept 2026 • Xavier         | 2026-09-23 |
      | 16 Sep 2026 · Ann             | 2026-09-16 |
      | Today                         | 2026-09-24 |
      | TODAY                         | 2026-09-24 |
      | Yesterday                     | 2026-09-23 |
      | Today • 2 purchases           | 2026-09-24 |

  Scenario Outline: Ordinary text is never a date header
    Then "<text>" should not be a date header

    Examples:
      | text              |
      | Order 12          |
      | Table 5           |
      | 2 Pending         |
      | 25 Aug - 30 Aug   |
      | Paid 16 Sep       |
      | 16 Sep Kopitiam   |
      | 16 Sep (Kopitiam) |
      | 1:12 PM           |
      | 2026              |
      | Pending • Xavier  |
      | In-App Purchase   |

  Scenario Outline: Text holding no real date resolves to none
    Then the date in "<text>" should be none

    Examples:
      | text                             |
      | spent 30 dollars at the shop     |
      | may buy coffee                   |
      | 12.05                            |
      | 31/02/2026                       |
      | 13/13/2026                       |
      | 2026                             |
      | 1:12 PM                          |
      | Pending                          |
      | Subway#55604-0 Phone 9298 2185   |

  Scenario Outline: When text holds several dates, the right one wins
    Then the date in "<text>" should be <date>

    Examples:
      | text                                                        | date       |
      | spent 10 June 24 at the market                              | 2026-06-24 |
      | 604 sembawang road 02-25 served by: 82 16/09/2026 13:12:18  | 2026-09-16 |
      | 604 sembawang road 02-25 served by: 82 16/09 13:12:18       | 2026-09-16 |
      | paid 10 on 03/04 then 05/06                                 | 2026-04-03 |
      | 31/02/2026 or 16/09/2026                                    | 2026-09-16 |

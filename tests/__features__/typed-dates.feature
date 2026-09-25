Feature: Dates in typed text come from the user's words, never the model
  resolveTypedDate reads the date a user typed ("lunch yesterday 12", "last
  friday", "two days ago", "on the 3rd"). On iOS 27 the on-device model dates
  undated text YESTERDAY, so the FM path uses resolveTypedDate(text) ?? now:
  every phrase a person types to mean a day must be here, because anything
  this misses silently becomes today. "Now" is Friday 25 Sep 2026, 12:00.

  Scenario Outline: A typed phrase names a day
    Then typing "<text>" should date it <date>

    Examples:
      | text                          | date       |
      | lunch today 12                | 2026-09-25 |
      | coffee this morning 5         | 2026-09-25 |
      | lunch yesterday 12            | 2026-09-24 |
      | dinner last night 40          | 2026-09-24 |
      | taxi day before yesterday 9   | 2026-09-23 |
      | dinner 2 days ago 30          | 2026-09-23 |
      | snack two days ago 3          | 2026-09-23 |
      | drinks a couple of days ago 20| 2026-09-23 |
      | dinner 3 days back 20         | 2026-09-22 |
      | rent last week 1200           | 2026-09-18 |
      | gym two weeks ago 50          | 2026-09-11 |
      | groceries last friday 40      | 2026-09-18 |
      | lunch last tuesday 12         | 2026-09-22 |
      | movie on monday 15            | 2026-09-21 |
      | brunch this sunday 30         | 2026-09-20 |
      | coffee on fri 5               | 2026-09-25 |
      | grab past wed 8               | 2026-09-23 |
      | coffee on the 3rd 5           | 2026-09-03 |
      | lunch on the 25th 9           | 2026-09-25 |
      | lunch on the 26th 9           | 2026-08-26 |
      | paid 20 on 23 sept            | 2026-09-23 |

  Scenario Outline: Text that names no day stays undated, so the caller uses today
    Then typing "<text>" should name no date

    Examples:
      | text                  |
      | coffee 4.80           |
      | Sunday Folks 12       |
      | TGI Fridays 45        |
      | grab tuesday 8        |
      | lunch 12 at monday bar|

  Scenario: "on the 28th" typed early in January is last December
    Then typing "dinner on the 28th 30" on 2027-01-05 should date it 2026-12-28

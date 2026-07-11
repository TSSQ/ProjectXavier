Feature: Dashboard chart carousel page metadata
  The dashboard's chart card is a 4-page swipeable carousel (account balances,
  cash flow, expenses by category, income by category). This is the pure
  title/page-count logic app/(tabs)/dashboard.tsx renders from — extracted so a
  future edit that reverts the header/dots to a stale 2-page assumption is
  caught here, not just by a visual scan of the screen.

  Scenario: There are four carousel pages
    Then the carousel page count should be 4

  Scenario Outline: Each page has its own header title
    Then the title for chart page <page> should be "<title>"

    Examples:
      | page | title                 |
      | 0    | Account balances      |
      | 1    | Cash flow             |
      | 2    | Expenses by category  |
      | 3    | Income by category    |

  Scenario: A negative page index clamps to the first page's title
    Then the title for chart page -1 should be "Account balances"

  Scenario: A page index past the last page clamps to the last page's title
    Then the title for chart page 99 should be "Income by category"

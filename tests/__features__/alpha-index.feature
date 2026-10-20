Feature: Alphabetical lists and the quick-scroll index
  Payees and categories are sorted A-Z at display time only; the repositories
  keep insertion order because the FM grounding prompt depends on it
  (docs/design/az-sorted-lists-spec.md).

  Scenario: Names sort case-insensitively
    When I sort the names "Cold Storage", "apple", "Banana"
    Then the order is "apple", "Banana", "Cold Storage"

  Scenario: Numbers inside names sort numerically
    When I sort the names "Item 10", "Item 2"
    Then the order is "Item 2", "Item 10"

  Scenario: Sorting does not mutate the input
    When I sort the names "b", "a"
    Then the original input is still "b", "a"

  Scenario: Diacritics index under their base letter
    Then the index key of "Éclair" is "E"

  Scenario: Non-letters index under hash
    Then the index key of "7-Eleven" is "#"
    And the index key of "😀 Cafe" is "#"
    And the index key of "" is "#"

  Scenario: The hash group is last
    When I group the names "7-Eleven", "Zoo", "apple", "😀 Cafe", ""
    Then the group keys are "A", "Z", "#"

  Scenario: Sliding onto an empty letter snaps forward
    Then with populated keys "A", "D" the nearest to "B" is "D"

  Scenario: Past the last populated letter falls back backward
    Then with populated keys "A", "D" the nearest to "Z" is "D"

  Scenario: Nothing populated gives no key
    Then with populated keys none the nearest to "B" is none

  Scenario Outline: The rail shows only for long, unsearched lists
    Then the rail for <count> items and query "<query>" is shown: <shown>

    Examples:
      | count | query | shown |
      | 14    |       | no    |
      | 15    |       | yes   |
      | 15    | pa    | no    |
      | 40    | pa    | no    |

  Scenario: A whitespace-only query counts as empty
    Then the rail for 20 items and a blank query is shown

  Scenario: Leading whitespace is ignored for the index key
    Then the index key of "  apple" is "A"

  Scenario: Tilde letters index under their base letter
    Then the index key of "ñandú" is "N"

  Scenario: A lone combining mark indexes under hash
    Then the index key of a lone combining acute accent is "#"

  Scenario: Hash mixes with letters and still sorts last
    When I group the names "9 Lives", "Bob", "#1 Fan", "Al"
    Then the group keys are "A", "B", "#"

  Scenario: An unknown key resolves to nothing
    Then with populated keys "A", "D" the nearest to "?" is none

  Scenario Outline: A touch position maps to a letter slot
    Then a touch at <y> on a rail of height <height> with <count> slots maps to <index>

    Examples:
      | y    | height | count | index |
      | -10  | 270    | 27    | 0     |
      | 0    | 270    | 27    | 0     |
      | 9    | 270    | 27    | 0     |
      | 10   | 270    | 27    | 1     |
      | 269  | 270    | 27    | 26    |
      | 270  | 270    | 27    | 26    |
      | 400  | 270    | 27    | 26    |
      | 50   | 0      | 27    | none  |

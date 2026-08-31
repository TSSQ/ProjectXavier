Feature: Interactive colours clear their contrast bar

  `primary` has two jobs with opposite requirements, and no single dark blue
  satisfies both: white on #5B8DEF is 3.23:1 where text needs 4.5, and
  darkening it far enough to pass as a FILL drops it below 4.5 as TEXT on a
  dark card. Hence primaryFill.

  Scenario: White text on a primary fill is readable, dark
    Then "#FFFFFF" on "#3E6FD4" should clear 4.5

  Scenario: White text on a primary fill is readable, light
    Then "#FFFFFF" on "#2F6BDD" should clear 4.5

  Scenario: Primary as text on a dark card is readable
    Then "#5B8DEF" on "#171B22" should clear 4.5

  Scenario: Primary as text on a light card is readable
    Then "#2F6BDD" on "#FFFFFF" should clear 4.5

  # The reason the split exists: the fill value would FAIL as text, and the
  # text value DOES fail as a fill. Either would be a plausible "simplification".
  Scenario: The two values are genuinely different in dark
    Then the dark fill and text values should differ

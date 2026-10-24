Feature: Dashboard lays out in two columns on a wide screen (iPhone Duo)
  Below 600pt of content width the Dashboard keeps the phone layout: one
  column with a paged chart carousel. From 600pt up (iPhone Duo's open display,
  either orientation) it shows the summary on the left and all four charts as a
  2x2 grid on the right. src/domain/dashboardLayout.ts decides the mode and the
  column, tile and chart widths from the content width, which the screen
  computes as window width minus the horizontal insets minus the 48pt gutter.
  See docs/design/duo-dashboard-grid-spec.md.

  # ── One column ───────────────────────────────────────────────────────────
  Scenario: iPhone 17 Pro in portrait stays on one column
    When I lay out the dashboard for a content width of 354
    Then the dashboard should have 1 column
    And the left width should be 354
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  Scenario: Duo cover display with the rail on the right stays on one column
    When I lay out the dashboard for a content width of 334
    Then the dashboard should have 1 column
    And the left width should be 334
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  Scenario: Duo Split View half stays on one column
    When I lay out the dashboard for a content width of 202
    Then the dashboard should have 1 column
    And the left width should be 202
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  # ── Two columns ──────────────────────────────────────────────────────────
  Scenario: Duo open display in portrait splits into two columns
    When I lay out the dashboard for a content width of 621
    Then the dashboard should have 2 columns
    And the left width should be 275
    And the right width should be 330
    And the tile width should be 159
    And the tile content width should be 125
    And the tile donut should be 65

  Scenario: Duo open display in landscape with the rail on the right splits into two columns
    When I lay out the dashboard for a content width of 819
    Then the dashboard should have 2 columns
    And the left width should be 365
    And the right width should be 438
    And the tile width should be 213
    And the tile content width should be 179
    And the tile donut should be 93

  # ── Threshold ────────────────────────────────────────────────────────────
  Scenario: One point short of the threshold is still one column
    When I lay out the dashboard for a content width of 599
    Then the dashboard should have 1 column
    And the left width should be 599
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  Scenario: Exactly the threshold is two columns
    When I lay out the dashboard for a content width of 600
    Then the dashboard should have 2 columns
    And the left width should be 265
    And the right width should be 319
    And the tile width should be 153
    And the tile content width should be 119
    And the tile donut should be 62

  Scenario: One point over the threshold rounds the summary column to nearest
    When I lay out the dashboard for a content width of 601
    Then the dashboard should have 2 columns
    And the left width should be 266
    And the right width should be 319
    And the tile width should be 153
    And the tile content width should be 119
    And the tile donut should be 62

  Scenario: A very wide screen caps the tile ring at the donut maximum
    When I lay out the dashboard for a content width of 1600
    Then the dashboard should have 2 columns
    And the left width should be 720
    And the right width should be 864
    And the tile width should be 426
    And the tile content width should be 392
    And the tile donut should be 190

  # ── Hostile input ────────────────────────────────────────────────────────
  Scenario: A negative width is one empty column
    When I lay out the dashboard for a content width of -50
    Then the dashboard should have 1 column
    And the left width should be 0
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  Scenario: A NaN width is one empty column
    When I lay out the dashboard for a content width of NaN
    Then the dashboard should have 1 column
    And the left width should be 0
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  Scenario: An infinite width is treated as zero
    When I lay out the dashboard for a content width of Infinity
    Then the dashboard should have 1 column
    And the left width should be 0
    And the right width should be 0
    And the tile width should be 0
    And the tile content width should be 0
    And the tile donut should be 0

  # ── Invariants ───────────────────────────────────────────────────────────
  Scenario: The two columns and their gap add up to the content width
    When I lay out the dashboard for a content width of 700
    Then the dashboard should have 2 columns
    And the left width plus the column gap plus the right width should be 700
    And two tiles plus the grid gap should fit inside the right width

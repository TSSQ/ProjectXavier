Feature: The dashboard chart carousel is sized from the screen

  Four slides share one pager. The charts used to default to a hardcoded width
  of 300 while the slides were derived from the screen, so the same carousel
  left dead space on a large phone and overflowed on a small one.

  Scenario: Charts fill their slide on a large phone
    Given a screen 430 points wide
    Then the slide width should be 382
    And the content width should be 350

  Scenario: Charts fit their slide on a small phone
    Given a screen 375 points wide
    Then the slide width should be 327
    And the content width should be 295

  Scenario: A chart never gets a negative width
    Given a screen 0 points wide
    Then the content width should be 0

  # The value tracks the ring now; the invariant that matters is that all four
  # slides share ONE height, which the scenario below pins by relationship.
  Scenario: Every chart draws at the same height
    Given a screen 430 points wide
    Then the chart height should be 182

  # The ring is centred now, so it has the whole slide to sit in. A constant
  # that looks right on a 430pt phone looks oversized on a 375pt one.
  Scenario: The ring scales with the slide
    Given a screen 430 points wide
    Then the ring should be 182

  Scenario: The ring scales down on a small phone
    Given a screen 375 points wide
    Then the ring should be 153

  Scenario: The ring is capped on a very wide screen
    Given a screen 1200 points wide
    Then the ring should be 190

  # Otherwise the dead space just moves from the category pages onto the
  # line and bar pages.
  Scenario: Line and bar marks grow with the ring
    Given a screen 430 points wide
    Then the chart height should equal the ring

  # The reference draws a band about a fifth of the diameter. At a fixed 16pt
  # the band got relatively thinner as the ring grew, reading as a hairline.
  Scenario: The ring band scales with the ring
    Given a screen 430 points wide
    Then the ring stroke should be 36

  Scenario: The band stays proportional on a small phone
    Given a screen 375 points wide
    Then the ring stroke should be 31

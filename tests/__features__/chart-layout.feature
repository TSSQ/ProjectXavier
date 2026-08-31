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

  Scenario: Every chart draws at the same height
    Given a screen 430 points wide
    Then the chart height should be 120

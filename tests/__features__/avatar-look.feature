Feature: Avatar look selection
  Users can pick a colour look for the assistant avatar; an unknown or missing
  selection falls back to the default.

  Scenario: A known look id resolves to that look
    When I resolve the avatar look "mint"
    Then the look label should be "Mint"

  Scenario: An unknown look falls back to the default
    When I resolve the avatar look "nope"
    Then the look label should be "Xavier"

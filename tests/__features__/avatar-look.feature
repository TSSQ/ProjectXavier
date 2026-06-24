Feature: Avatar look and kind selection
  Users can pick an avatar kind (blob is the default) and, for the blob, a colour
  look. Unknown, missing, or not-yet-available selections fall back to defaults.

  Scenario: A known look id resolves to that look
    When I resolve the avatar look "mint"
    Then the look label should be "Mint"

  Scenario: An unknown look falls back to the default
    When I resolve the avatar look "nope"
    Then the look label should be "Xavier"

  Scenario: The default avatar kind is the blob
    When I resolve the avatar kind "blob"
    Then the kind label should be "Blob"

  Scenario: A not-yet-available kind falls back to the default
    When I resolve the avatar kind "animated"
    Then the kind label should be "Blob"

  Scenario: An unknown kind falls back to the default
    When I resolve the avatar kind "nope"
    Then the kind label should be "Blob"

Feature: global.css / tokens.ts sync
  global.css duplicates the palette from src/theme/tokens.ts as CSS custom
  properties so NativeWind className utilities stay in sync with the
  useThemeColors() hook. If the two ever drift, className consumers and
  inline-style consumers of the "same" token would render different colours,
  so the two sources must always agree.

  Scenario: Every dark token has a matching --color-* var in .dark:root
    Given the dark theme palette
    And the parsed .dark:root block from global.css
    Then every dark token key should have an equal value in .dark:root

  Scenario: Every light token has a matching --color-* var in :root
    Given the light theme palette
    And the parsed :root block from global.css
    Then every light token key should have an equal value in :root

  Scenario: global.css declares no orphaned --color-* vars
    Given the dark theme palette
    And the parsed :root block from global.css
    And the parsed .dark:root block from global.css
    Then every --color-* var should correspond to a tokens.ts key

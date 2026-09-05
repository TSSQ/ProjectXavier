Feature: GLASS_UI_ENABLED default
  glass-phase2 round 5 fix M3: `GLASS_UI_ENABLED` (src/lib/flags.ts) flipped
  default in Phase 2 — glass is now ON unless explicitly turned off via
  `EXPO_PUBLIC_GLASS=0`. This locks that default in, plus both explicit
  settings, so a future edit that flips it back can't land unnoticed.

  Scenario: Unset defaults to enabled
    Given EXPO_PUBLIC_GLASS is unset
    When I read GLASS_UI_ENABLED
    Then GLASS_UI_ENABLED should be true

  Scenario: "0" disables it
    Given EXPO_PUBLIC_GLASS is "0"
    When I read GLASS_UI_ENABLED
    Then GLASS_UI_ENABLED should be false

  Scenario: "1" enables it
    Given EXPO_PUBLIC_GLASS is "1"
    When I read GLASS_UI_ENABLED
    Then GLASS_UI_ENABLED should be true

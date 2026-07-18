Feature: BYOK API key masking
  docs/design/byok-saved-key-card-spec.md's saved-key card shows a masked hint
  of the key instead of an always-empty field. maskApiKey reveals only the
  last 4 characters behind a constant run of mask dots, and never leaks the
  real key's length or contents.

  Scenario: A normal long key reveals exactly the last 4 characters
    When I mask the key "sk-live-abcdef3f9k"
    Then the masked result should be "••••••••3f9k"

  Scenario: A key shorter than 8 characters is fully masked
    When I mask the key "sk-1"
    Then the masked result should be "••••••••"
    And the masked result should not contain any of the original characters

  Scenario: A key exactly at the 8-character boundary reveals the last 4
    When I mask the key "abcdefgh"
    Then the masked result should be "••••••••efgh"

  Scenario: The masked result is never equal to the original key
    When I mask the key "sk-live-abcdef3f9k"
    Then the masked result should not equal the original key

  Scenario: An empty key is fully masked without throwing
    When I mask the key ""
    Then the masked result should be "••••••••"

  Scenario: A null key is fully masked without throwing
    When I mask a null key
    Then the masked result should be "••••••••"

  Scenario: An undefined key is fully masked without throwing
    When I mask an undefined key
    Then the masked result should be "••••••••"

  Scenario: An emoji straddling the last-4 boundary is never split into a lone surrogate
    When I mask the key "prefix12🔥xyz"
    Then the masked result should be "••••••••🔥xyz"
    And the masked result should not contain an unpaired surrogate

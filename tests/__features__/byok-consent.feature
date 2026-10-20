Feature: BYOK consent
  docs/design/byok-consent-spec.md — App Store guideline 5.1.2(i). BYOK only
  sends user text to OpenAI/Anthropic when the toggle is on AND the user has
  explicitly consented for that provider. Consent is per provider.

  Scenario Outline: byokActive needs both the toggle and consent
    When BYOK enabled is <enabled> and consent for the provider is <consented>
    Then BYOK should be active: <active>

    Examples:
      | enabled | consented | active |
      | true    | true      | true   |
      | true    | false     | false  |
      | false   | true      | false  |
      | false   | false     | false  |

  Scenario Outline: The consent copy names the provider
    When I read the consent copy for "<provider>"
    Then the title should be "Send expenses to <name>?"
    And the body should mention "<name>" and "your own API key"
    And the buttons should be "Allow" and "Not now"

    Examples:
      | provider  | name      |
      | openai    | OpenAI    |
      | anthropic | Anthropic |

  Scenario: Consent is per provider
    Given the user has consented for "openai" only
    Then BYOK should be active for "openai" when enabled
    And BYOK should not be active for "anthropic" when enabled

  Scenario: Another provider consent never activates the current provider
    Then openai consent with provider anthropic should not be active

  Scenario: Only allowlisted files can reach a BYOK engine
    Then the files importing the BYOK engines or query loop should be the allowlist

  Scenario: Provider endpoints appear only in allowlisted files
    Then the files containing provider API hosts should be the allowlist

  Scenario: The parse path gates the BYOK engine on consent
    Then the parse path source should reference byokActive and getByokConsent

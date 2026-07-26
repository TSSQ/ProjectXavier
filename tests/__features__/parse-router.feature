Feature: Parse engine router
  routeEngines decides the order runParse tries its parse engines in, given
  device AI capability, the BYOK (bring-your-own-key) preference, and network
  reachability. resolveByokEnabled decides whether a BYOK config that says
  "on" should actually count as on (a saved key is required).

  Scenario: BYOK off, device AI capable — foundation then heuristic
    Given deviceAiCapable is true
    And BYOK is off
    And the device is online
    When I route engines
    Then the engine order should be "foundation, heuristic"

  Scenario: BYOK off, device AI not capable — heuristic only
    Given deviceAiCapable is false
    And BYOK is off
    And the device is online
    When I route engines
    Then the engine order should be "heuristic"

  Scenario: BYOK on with openai and online — provider runs first
    Given deviceAiCapable is true
    And BYOK is on with provider "openai"
    And the device is online
    When I route engines
    Then the engine order should be "openai, foundation, heuristic"

  Scenario: BYOK on with anthropic and online — provider runs first
    Given deviceAiCapable is true
    And BYOK is on with provider "anthropic"
    And the device is online
    When I route engines
    Then the engine order should be "anthropic, foundation, heuristic"

  Scenario: BYOK on but offline — provider is dropped, falls to foundation/heuristic
    Given deviceAiCapable is true
    And BYOK is on with provider "openai"
    And the device is offline
    When I route engines
    Then the engine order should be "foundation, heuristic"

  Scenario: BYOK on but offline, no device AI — heuristic only
    Given deviceAiCapable is false
    And BYOK is on with provider "openai"
    And the device is offline
    When I route engines
    Then the engine order should be "heuristic"

  Scenario: BYOK on but no device AI, online — provider then heuristic
    Given deviceAiCapable is false
    And BYOK is on with provider "anthropic"
    And the device is online
    When I route engines
    Then the engine order should be "anthropic, heuristic"

  Scenario: BYOK config resolution — enabled with a saved key stays enabled
    Given a BYOK config with enabled true and a saved key
    When I resolve the BYOK enabled flag
    Then the resolved BYOK enabled flag should be true

  Scenario: BYOK config resolution — enabled but no key saved yet resolves to off
    Given a BYOK config with enabled true and no saved key
    When I resolve the BYOK enabled flag
    Then the resolved BYOK enabled flag should be false

  Scenario: BYOK config resolution — disabled stays disabled even with a saved key
    Given a BYOK config with enabled false and a saved key
    When I resolve the BYOK enabled flag
    Then the resolved BYOK enabled flag should be false

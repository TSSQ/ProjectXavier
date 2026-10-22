Feature: Question engine router
  routeQueryEngines decides the order the Ask-Xavier question path tries its
  engines in. The deterministic floor always runs first (measured: it is right
  on all but its recorded gaps where it answers, and stands aside otherwise),
  then the user's BYOK provider when it is on and reachable, then on-device
  Foundation Models when the device can run it. When every engine declines,
  the app replies "I can answer things like…" — not an engine. The expense
  order (routeEngines) is unchanged.

  Scenario Outline: Every combination of BYOK, connectivity and device AI
    Given deviceAiCapable is <capable>
    And BYOK is <byok>
    And the device is <network>
    When I route question engines
    Then the question engine order should be "<order>"
    And the expense engine order should still be "<expense>"

    Examples:
      | capable | byok           | network | order                        | expense                           |
      | true    | off            | online  | floor, foundation            | foundation, heuristic             |
      | true    | off            | offline | floor, foundation            | foundation, heuristic             |
      | false   | off            | online  | floor                        | heuristic                         |
      | false   | off            | offline | floor                        | heuristic                         |
      | true    | on (openai)    | online  | floor, openai, foundation    | openai, foundation, heuristic     |
      | true    | on (anthropic) | online  | floor, anthropic, foundation | anthropic, foundation, heuristic  |
      | true    | on (openai)    | offline | floor, foundation            | foundation, heuristic             |
      | false   | on (anthropic) | online  | floor, anthropic             | anthropic, heuristic              |
      | false   | on (openai)    | offline | floor                        | heuristic                         |

  Scenario: BYOK toggled on with no provider picked is treated as off
    Given deviceAiCapable is true
    And BYOK is on with no provider
    And the device is online
    When I route question engines
    Then the question engine order should be "floor, foundation"

  Scenario: The floor appears exactly once, first, in every order
    When I route question engines for every context
    Then each order starts with "floor" and contains it once

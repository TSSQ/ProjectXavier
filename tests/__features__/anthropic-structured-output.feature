Feature: The Anthropic engine asks every current Claude model for one structured object
  Claude Fable 5.1, Opus 5.5 and Sonnet 5.5 reject a forced tool_choice with a
  400, so the BYOK Anthropic parse engine (src/features/ai/engines/anthropic.ts)
  asks for structured outputs (output_config.format, a json_schema) and reads
  the JSON from the reply's text block; only ids older than 4.5, which lack
  structured outputs, keep the forced tool (anthropicOutputMode in
  src/domain/byokSampling.ts). The question loop never forces a tool on any
  model.

  Scenario Outline: The output mode is picked from the model id
    When I pick the Anthropic output mode for "<model>"
    Then the output mode should be "<mode>"

    Examples:
      | model                      | mode              |
      | claude-haiku-5-5           | structured_output |
      | claude-sonnet-5-5          | structured_output |
      | claude-opus-5-5            | structured_output |
      | claude-fable-5-1           | structured_output |
      | claude-opus-4-8            | structured_output |
      | claude-opus-4-7            | structured_output |
      | claude-sonnet-4-6          | structured_output |
      | claude-haiku-4-5           | structured_output |
      | claude-opus-4-5-20251101   | structured_output |
      | claude-opus-latest         | structured_output |
      | claude-opus-4-1            | forced_tool       |
      | claude-sonnet-4-20250514   | forced_tool       |
      | claude-3-5-haiku-latest    | forced_tool       |

  Scenario Outline: The structured-output reply yields the object in its text block
    Given an Anthropic structured-output reply of kind "<kind>"
    When I extract the Anthropic structured output
    Then the structured output should be "<outcome>"

    Examples:
      | kind                        | outcome |
      | json-text                   | object  |
      | thinking-then-json-text     | object  |
      | text-not-json               | null    |
      | json-is-an-array            | null    |
      | json-is-a-number            | null    |
      | no-text-block               | null    |
      | tool-use-only               | null    |
      | stop-refusal                | null    |
      | stop-max-tokens             | null    |
      | content-not-an-array        | null    |
      | non-object-response         | null    |

  Scenario: Every contract schema is made acceptable to structured outputs
    When I adapt every parse contract's schema for structured outputs
    Then no adapted schema carries "$schema" or a numeric or length constraint
    And every adapted object schema sets additionalProperties to false
    And the adapted schemas keep their properties, enums and required lists

  Scenario Outline: The request body matches the output mode
    Given a mocked Anthropic reply in the requested shape
    When I call fetchAnthropicRaw for model "<model>" with EXPENSE_PARSE_CONTRACT
    Then the request should ask for "<mode>"
    And the raw object should be returned

    Examples:
      | model                   | mode              |
      | claude-sonnet-5-5       | structured_output |
      | claude-haiku-5-5        | structured_output |
      | claude-3-5-haiku-latest | forced_tool       |

  Scenario Outline: A parse reads only the reply shape its mode asked for
    Given a mocked Anthropic reply of kind "<reply>"
    When I run anthropicParseResult for model "<model>" and text "coffee 5"
    Then the Anthropic parse outcome should be "<outcome>"

    Examples:
      | model                   | reply           | outcome    |
      | claude-sonnet-5-5       | json-text       | ok         |
      | claude-sonnet-5-5       | stop-refusal    | bad_output |
      | claude-sonnet-5-5       | tool-use-only   | bad_output |
      | claude-sonnet-5-5       | status 400      | rejected   |
      | claude-3-5-haiku-latest | tool-use-only   | ok         |
      | claude-3-5-haiku-latest | json-text       | bad_output |

  Scenario Outline: Test key round-trips on both paths
    Given a mocked Anthropic reply in the requested shape
    When I test an Anthropic key on model "<model>"
    Then the test-key result should be "ok"

    Examples:
      | model                   |
      | claude-sonnet-5-5       |
      | claude-3-5-haiku-latest |

  Scenario Outline: The question loop never forces a tool
    Given a mocked Anthropic question loop that calls one tool and then answers
    When I run the Anthropic question loop on model "<model>"
    Then no request should carry a forced tool_choice
    And the loop should return the tool call and the narration

    Examples:
      | model                   |
      | claude-sonnet-5-5       |
      | claude-haiku-5-5        |
      | claude-3-5-haiku-latest |

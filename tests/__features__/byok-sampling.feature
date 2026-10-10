Feature: BYOK sampling parameters — temperature 0 only where the model accepts it
  src/domain/byokSampling.ts decides, per raw model id, whether a BYOK request
  body carries `temperature: 0` (determinism) or omits it (the model would
  reject it with a 400 — a lost parse, worse than a nondeterministic one).
  Allowlist semantics: unknown ids get nothing.

  Scenario Outline: OpenAI — the non-reasoning GPT families accept temperature, reasoning models don't
    When I ask whether OpenAI model "<model>" supports temperature
    Then the answer should be <supported>

    Examples:
      | model                | supported |
      | gpt-4.1-mini         | true      |
      | gpt-4.1              | true      |
      | gpt-4o-mini          | true      |
      | gpt-4o-2024-08-06    | true      |
      | gpt-3.5-turbo        | true      |
      | chatgpt-4o-latest    | true      |
      | gpt-5-chat-latest    | true      |
      | GPT-4.1-MINI         | true      |
      | o1                   | false     |
      | o3-mini              | false     |
      | o4-mini              | false     |
      | gpt-5                | false     |
      | gpt-5-mini           | false     |
      | gpt-5.4-mini         | false     |
      | gpt-6-luna           | false     |
      | something-new        | false     |
      |                      | false     |

  Scenario Outline: Anthropic — Claude 4.6 and earlier accept temperature, 4.7+ reject it
    When I ask whether Anthropic model "<model>" supports temperature
    Then the answer should be <supported>

    Examples:
      | model                       | supported |
      | claude-haiku-4-5            | true      |
      | claude-haiku-4-5-20251001   | true      |
      | claude-3-5-haiku-latest     | true      |
      | claude-3-5-haiku-20241022   | true      |
      | claude-3-7-sonnet-latest    | true      |
      | claude-sonnet-4-20250514    | true      |
      | claude-opus-4-1             | true      |
      | claude-sonnet-4-6           | true      |
      | claude-opus-4-7             | false     |
      | claude-opus-4-8             | false     |
      | claude-sonnet-5             | false     |
      | claude-haiku-5-5            | false     |
      | claude-opus-5-5             | false     |
      | claude-fable-5-1            | false     |
      | claude-mystery              | false     |
      | gpt-4.1-mini                | false     |
      |                             | false     |

  Scenario Outline: The request-body fragment is exactly temperature 0 or nothing
    When I build the sampling params for provider "<provider>" and model "<model>"
    Then the fragment should be <fragment>

    Examples:
      | provider  | model            | fragment          |
      | openai    | gpt-4.1-mini     | {"temperature":0} |
      | openai    | o4-mini          | {}                |
      | anthropic | claude-haiku-4-5 | {"temperature":0} |
      | anthropic | claude-haiku-5-5 | {}                |

  Scenario: The default OpenAI model is still offered by the model picker's normalizer
    Given raw OpenAI models containing the default OpenAI model id
    When I normalize those OpenAI models
    Then the default OpenAI model id should be listed
    And the default OpenAI model should accept temperature

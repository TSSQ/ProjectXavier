Feature: BYOK model-picker normalizers
  src/domain/byokModels.ts reduces each provider's raw, untrusted
  `/v1/models` payload (docs/design/byok-model-picker-spec.md) into a
  ModelChoice[] the Settings model picker can render. Every field access is
  guarded (CLAUDE.md guardrail #6): a malformed payload normalizes to an
  empty list rather than throwing.

  Scenario: Anthropic keeps models unless structured outputs is explicitly unsupported
    Given raw Anthropic models:
      | id                | display_name       | structured_outputs_supported |
      | claude-haiku-4-5  | Claude Haiku 4.5   | true                          |
      | claude-old        | Claude Old          | false                         |
      | claude-sonnet-4-6 | Claude Sonnet 4.6  | absent                        |
    When I normalize the Anthropic models
    Then the normalized models should be:
      | id                | label              |
      | claude-haiku-4-5  | Claude Haiku 4.5   |
      | claude-sonnet-4-6 | Claude Sonnet 4.6  |

  Scenario: Anthropic label falls back to the id when display_name is missing
    Given raw Anthropic models:
      | id       | display_name | structured_outputs_supported |
      | claude-x |              | absent                        |
    When I normalize the Anthropic models
    Then the normalized models should be:
      | id       | label    |
      | claude-x | claude-x |

  Scenario: OpenAI keeps chat models, drops non-chat modalities, and sorts newest first
    Given raw OpenAI models:
      | id                     | created |
      | gpt-4o-mini            | 100     |
      | gpt-4o                 | 300     |
      | o3-mini                | 200     |
      | text-embedding-3-small | 400     |
      | whisper-1              | 500     |
      | dall-e-3               | 600     |
      | davinci-002            | 700     |
    When I normalize the OpenAI models
    Then the normalized models should be:
      | id          | label       |
      | gpt-4o      | gpt-4o      |
      | o3-mini     | o3-mini     |
      | gpt-4o-mini | gpt-4o-mini |

  Scenario Outline: A malformed payload never throws and normalizes to no models
    Given a "<kind>" raw payload for "<provider>"
    When I normalize the "<provider>" models
    Then the normalized models should be empty

    Examples:
      | provider  | kind           |
      | anthropic | not-an-object  |
      | anthropic | missing-data   |
      | anthropic | non-array-data |
      | anthropic | non-string-id  |
      | openai    | not-an-object  |
      | openai    | missing-data   |
      | openai    | non-array-data |
      | openai    | non-string-id  |

  Scenario: normalizeModels dispatches to Anthropic's normalizer
    Given raw Anthropic models:
      | id               | display_name     | structured_outputs_supported |
      | claude-haiku-4-5 | Claude Haiku 4.5 | true                          |
    When I normalize via normalizeModels for provider "anthropic"
    Then the normalized models should be:
      | id               | label            |
      | claude-haiku-4-5 | Claude Haiku 4.5 |

  Scenario: normalizeModels dispatches to OpenAI's normalizer
    Given raw OpenAI models:
      | id     | created |
      | gpt-4o | 100     |
    When I normalize via normalizeModels for provider "openai"
    Then the normalized models should be:
      | id     | label  |
      | gpt-4o | gpt-4o |

  Scenario: isKnownModel reports whether an id is present in the fetched list
    Given raw Anthropic models:
      | id               | display_name     | structured_outputs_supported |
      | claude-haiku-4-5 | Claude Haiku 4.5 | true                          |
    When I normalize the Anthropic models
    Then "claude-haiku-4-5" should be a known model
    And "claude-unknown" should not be a known model

  Scenario: Anthropic normalizer dedupes duplicate ids, keeping the first occurrence
    Given raw Anthropic models:
      | id               | display_name    | structured_outputs_supported |
      | claude-haiku-4-5 | Claude Haiku 4.5 | true                         |
      | claude-haiku-4-5 | Duplicate Entry  | true                         |
    When I normalize the Anthropic models
    Then the normalized models should be:
      | id               | label            |
      | claude-haiku-4-5 | Claude Haiku 4.5 |

  Scenario: OpenAI normalizer dedupes duplicate ids, keeping the first occurrence
    Given raw OpenAI models:
      | id     | created |
      | gpt-4o | 100     |
      | gpt-4o | 200     |
    When I normalize the OpenAI models
    Then the normalized models should be:
      | id     | label  |
      | gpt-4o | gpt-4o |

  Scenario: Anthropic normalizer skips garbage items mixed into the data array
    Given a raw Anthropic payload with garbage items mixed in
    When I normalize the Anthropic models
    Then the normalized models should be:
      | id               | label            |
      | claude-haiku-4-5 | Claude Haiku 4.5 |

  Scenario: OpenAI normalizer skips garbage items mixed into the data array
    Given a raw OpenAI payload with garbage items mixed in
    When I normalize the OpenAI models
    Then the normalized models should be:
      | id     | label  |
      | gpt-4o | gpt-4o |

  Scenario Outline: shouldApplyModelsResult guards a stale fetch by token alone
    Given a models fetch requested with token <requestToken>
    And the latest token is <latestToken>
    When I check whether the models result should apply
    Then the result should apply should be <expected>

    Examples:
      | requestToken | latestToken | expected |
      | 1             | 1           | true     |
      | 1             | 2           | false    |

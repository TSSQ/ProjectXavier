Feature: BYOK raw-fetch transport — response parsing, schema parity, and test-key status
  Pure, framework-free bits of the BYOK cloud raw-fetch migration
  (docs/design/byok-raw-fetch-spec.md): pulling the raw, still-untrusted
  device-parse object out of each provider's HTTP response body
  (src/domain/cloudParseTransport.ts), pinning
  src/domain/cloudParseSchema.ts's DEVICE_PARSE_JSON_SCHEMA against
  deviceParsePrompt.ts's deviceParseSchema so the two can never drift apart,
  and classifying a "Test key" round-trip (src/features/ai/testKey.ts) by the
  REAL HTTP status.

  Scenario: Anthropic's forced tool_use block yields the raw device-parse object
    Given an Anthropic response with a tool_use block containing:
      | amount | type    | category | payee     | account | confidence | pending |
      | 5      | expense | Coffee   | Starbucks | Amex    | 0.9        | false   |
    When I extract the Anthropic tool input
    Then the extracted object should equal the tool_use input

  Scenario Outline: Anthropic responses with no usable tool_use resolve to null
    Given an Anthropic response of kind "<kind>"
    When I extract the Anthropic tool input
    Then the extracted object should be null

    Examples:
      | kind                         |
      | text-only-no-tool-use        |
      | non-object-response          |
      | content-not-an-array         |
      | tool-use-block-missing-input |
      | tool-use-input-is-a-string   |
      | tool-use-input-is-a-number   |
      | tool-use-input-is-an-array   |

  Scenario: OpenAI's json_schema content yields the raw device-parse object
    Given an OpenAI response with json_schema content containing:
      | amount | type    | category | payee     | account | confidence | pending |
      | 5      | expense | Coffee   | Starbucks | Amex    | 0.9        | false   |
    When I extract the OpenAI json content
    Then the extracted object should equal the tool_use input

  Scenario Outline: OpenAI responses with no usable content resolve to null
    Given an OpenAI response of kind "<kind>"
    When I extract the OpenAI json content
    Then the extracted object should be null

    Examples:
      | kind                    |
      | content-not-valid-json  |
      | non-object-response     |
      | choices-not-an-array    |
      | empty-choices           |
      | content-not-a-string    |
      | content-is-a-number     |
      | content-is-an-array     |

  Scenario Outline: The cloud JSON schema is the on-device FM schema for the text's amount plan
    When I build the cloud expense JSON schema for "<text>"
    Then the JSON schema property keys should match the FM schema's fields for that plan
    And the JSON schema "type" enum should be expense, income, transfer
    And the JSON schema required fields should match the FM schema's required fields
    And the JSON schema should carry no "x-order" key
    And the JSON schema amount field should be "<amount>"

    Examples:
      | text                            | amount           |
      | coffee 5                        | absent           |
      | paid 45 and then 9.60 for lunch | enum 45, 9.6     |
      | lunch at the food court         | number           |

  Scenario Outline: A non-record raw object never reaches normalization
    Given a fetchRawObject stub that resolves to a raw value of kind "<kind>"
    When I run the cloud parse pipeline against text "coffee 5"
    Then the cloud parse result should fail with reason "bad_output"

    Examples:
      | kind   |
      | array  |
      | string |
      | number |

  Scenario Outline: testKey status classification uses the real HTTP status
    Given a test-key response with status <status> and a usable body of <usableBody>
    When I classify the test-key status
    Then the classification should be "<result>"

    Examples:
      | status | usableBody | result    |
      | 401    | false      | invalid   |
      | 403    | false      | invalid   |
      | 404    | false      | not_found |
      | 429    | false      | network   |
      | 200    | true       | ok        |
      | 200    | false      | network   |
      | 500    | true       | network   |
      | 500    | false      | network   |

  Scenario Outline: The testKey "usable" gate matches the record gate runCloudParse uses
    Given a raw model object of kind "<kind>"
    When I determine whether it is a usable record
    And I classify the test-key status 200 using that usable-record result
    Then the classification should be "<result>"

    Examples:
      | kind   | result  |
      | record | ok      |
      | array  | network |
      | string | network |
      | number | network |
      | null   | network |

  Scenario Outline: A BYOK parse failure is classified by the real HTTP status, key-free
    When I classify a cloud parse HTTP status of <status>
    Then the cloud failure reason should be "<reason>"

    Examples:
      | status | reason       |
      | 200    | none         |
      | 201    | none         |
      | 401    | auth         |
      | 403    | auth         |
      | 404    | not_found    |
      | 429    | rate_limited |
      | 400    | network      |
      | 500    | network      |
      | 529    | network      |

  Scenario Outline: The draft card says which key didn't answer, roughly why, and who took over
    When I build the cloud fallback notice for provider "<provider>" reason "<reason>" served by "<servedBy>"
    Then the notice should be "<notice>"

    Examples:
      | provider  | reason       | servedBy  | notice                                                                                        |
      | openai    | auth         | on_device | Your OpenAI key didn't answer (invalid key); parsed on-device instead.                        |
      | anthropic | rate_limited | on_device | Your Anthropic key didn't answer (rate limited); parsed on-device instead.                    |
      | openai    | not_found    | heuristic | Your OpenAI key didn't answer (model not found); this used basic parsing instead — check it before saving. |
      | anthropic | network      | heuristic | Your Anthropic key didn't answer (no connection or timed out); this used basic parsing instead — check it before saving. |
      | openai    | bad_output   | on_device | Your OpenAI key didn't answer (unusable reply); parsed on-device instead.                     |

  Scenario: The BYOK failure reason is recorded content-free on the provider's metric row
    When I build the cloud failure metric detail for reason "auth"
    Then the detail should be the JSON {"cloudFailure":"auth"}
    And cloud failure counts over rows with details auth, auth, rate_limited, an fmFallback row, null and junk should be auth 2 and rate_limited 1
    And fmFallback counts over the same rows should ignore the cloud rows

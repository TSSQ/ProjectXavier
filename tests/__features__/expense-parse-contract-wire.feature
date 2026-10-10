Feature: Expense parse contract stays byte-for-byte on the wire after ParseContract parameterization
  QA follow-up: fetchOpenAiRaw/fetchAnthropicRaw were generalized to run
  EITHER the expense or account contract (docs/design/account-chat-creation-
  spec.md §5.2). The highest-risk claim — "the expense path is unchanged" —
  had no test guarding the actual request body, so this locks the exact wire
  strings the ORIGINAL (pre-refactor) code sent when passed
  EXPENSE_PARSE_CONTRACT (contract is a REQUIRED argument — reviewer
  follow-up: a generic default here could only be expressed with an unsound
  `as unknown as` cast, so there is no default to test): OpenAI's
  `response_format.json_schema.name` stays "expense" (a different literal
  than Anthropic's tool name — the very mismatch a naive single `toolName`
  field would have collapsed), and Anthropic's forced tool name/tool_choice
  stay "record_expense".

  Scenario: fetchOpenAiRaw with EXPENSE_PARSE_CONTRACT keeps json_schema.name "expense"
    Given a mocked OpenAI success response
    When I call fetchOpenAiRaw with EXPENSE_PARSE_CONTRACT
    Then the captured request body's response_format.json_schema.name should be "expense"

  Scenario: fetchAnthropicRaw with EXPENSE_PARSE_CONTRACT keeps the "record_expense" tool
    Given a mocked Anthropic success response
    When I call fetchAnthropicRaw with EXPENSE_PARSE_CONTRACT
    Then the captured request body's tools[0].name should be "record_expense"
    And the captured request body's tool_choice.name should be "record_expense"

  Scenario Outline: temperature 0 is sent only to models that accept it
    Given a mocked <provider> success response
    When I call the <provider> raw fetch for model "<model>" with EXPENSE_PARSE_CONTRACT
    Then the captured request body's temperature should be <temperature>

    Examples:
      | provider  | model                      | temperature |
      | OpenAI    | gpt-4.1-mini               | 0           |
      | OpenAI    | gpt-4o-mini                | 0           |
      | OpenAI    | o4-mini                    | absent      |
      | OpenAI    | gpt-5-mini                 | absent      |
      | Anthropic | claude-haiku-4-5           | 0           |
      | Anthropic | claude-3-5-haiku-latest    | 0           |
      | Anthropic | claude-sonnet-4-6          | 0           |
      | Anthropic | claude-opus-4-7            | absent      |
      | Anthropic | claude-haiku-5-5           | absent      |

  Scenario: A JPY amount read by a cloud model is stored in minor units of the app currency
    Given a mocked Anthropic success response with amount 500
    When I run anthropicParseResult for text "coffee 500" in currency "JPY"
    Then the cloud parse should succeed with amount 500 minor

  Scenario: The same amount in a 2-decimal currency scales by 100
    Given a mocked Anthropic success response with amount 500
    When I run anthropicParseResult for text "coffee 500" in currency "USD"
    Then the cloud parse should succeed with amount 50000 minor

  Scenario Outline: A failed BYOK request reports a key-free reason instead of a bare null
    Given a mocked <provider> response of kind "<kind>"
    When I run the <provider> parse result for text "coffee 5"
    Then the cloud parse should fail with reason "<reason>"
    And the <provider> parse value-or-null wrapper should be null

    Examples:
      | provider  | kind                 | reason       |
      | OpenAI    | status 401           | auth         |
      | OpenAI    | status 404           | not_found    |
      | OpenAI    | status 429           | rate_limited |
      | OpenAI    | status 500           | network      |
      | OpenAI    | throws TypeError     | network      |
      | OpenAI    | 200 unparsable body  | bad_output   |
      | OpenAI    | 200 schema-invalid   | bad_output   |
      | Anthropic | status 403           | auth         |
      | Anthropic | status 429           | rate_limited |
      | Anthropic | throws AbortError    | network      |
      | Anthropic | 200 no tool_use      | bad_output   |

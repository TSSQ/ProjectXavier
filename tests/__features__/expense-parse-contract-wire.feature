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

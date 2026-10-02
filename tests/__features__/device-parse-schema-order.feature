Feature: A deterministic, pinned field order for the on-device parse schema
  Step 1a.5: `@react-native-ai/apple`'s native schema parser used to build a
  model's fields by iterating a Swift Dictionary, whose order is randomized
  per call — so the model's accuracy was effectively random too, since
  experiments proved it's a deterministic function of (case, field order).
  `src/domain/deviceParseSchemaOrder.ts` is the one place that derives the
  JSON Schema `generateObject` sends plus an explicit "x-order" key, which
  the patched native parser (patches/@react-native-ai+apple+*.patch) honours
  to build the model's fields in a fixed order instead.

  Scenario: DEVICE_PARSE_FIELD_ORDER is an exact permutation of the zod schema's own keys
    When DEVICE_PARSE_FIELD_ORDER is compared against deviceParseSchema's keys
    Then it names exactly the same set of fields, once each

  # Asserted against the LITERAL order below, not against DEVICE_PARSE_FIELD_
  # ORDER itself — comparing the constant to itself would be tautological (it
  # can never fail, even if someone swaps two entries). Changing this literal
  # requires a new `npm run eval:fm:replay` measurement and an update to
  # evals/README.md's field-order table.
  Scenario: The ordered JSON Schema carries "x-order" equal to the pinned literal field order by default
    When the ordered JSON Schema is derived with no explicit order
    Then its "x-order" equals the literal order: isTransaction, amount, category, payee, type, currency, account, note, occurredOn, confidence, pending

  Scenario: The ordered JSON Schema is otherwise byte-identical to the plain AI SDK conversion
    When the ordered JSON Schema is derived with no explicit order
    Then its "type" is "object"
    And its "properties" keys equal the "x-order" set exactly
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of deviceParseSchema

  Scenario: An explicit order overrides "x-order" without changing anything else
    When the ordered JSON Schema is derived with the order: pending, confidence, occurredOn, note, account, payee, category, currency, type, amount, isTransaction
    Then its "x-order" equals: pending, confidence, occurredOn, note, account, payee, category, currency, type, amount, isTransaction
    And its "type" is "object"
    And its "properties" keys equal the "x-order" set exactly
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of deviceParseSchema

  # The expense parse (`deviceParseUnsafe`, src/features/ai/deviceParse.ts)
  # gets its schema from `src/domain/deviceSchemas.ts`'s
  # `deviceParseSchemaFor(plan)` (built via the generalised
  # `orderedJsonSchema` helper) rather than `getDeviceParseOrderedJsonSchema()`
  # directly — this keeps the app and the eval harness (which calls
  # `getDeviceParseOrderedJsonSchema(plan)`) in lockstep on the exact same
  # JSON Schema, for every amount plan.
  Scenario Outline: deviceParseSchemaFor's JSON Schema is identical to getDeviceParseOrderedJsonSchema()
    When the "<plan>" amount plan's deviceParseSchemaFor jsonSchema is compared against getDeviceParseOrderedJsonSchema
    Then they are deeply equal

    Examples:
      | plan   |
      | model  |
      | single |
      | choice |

  # Step 3: the amount is read by code where it can be, so the schema depends
  # on the text. A single candidate takes `amount` out of the model's hands.
  Scenario: A single-candidate plan has no amount field and an x-order to match
    When the ordered JSON Schema is derived for a "single" amount plan
    Then its "properties" has no "amount" key
    And its "x-order" equals the literal order without amount: isTransaction, category, payee, type, currency, account, note, occurredOn, confidence, pending
    And its "properties" keys equal the "x-order" set exactly

  Scenario: A several-candidate plan makes amount a closed choice of exactly those candidates
    When the ordered JSON Schema is derived for a "choice" amount plan
    Then its "amount" property is an enum of "45", "9.6"
    And its "x-order" still names amount
    And its "properties" keys equal the "x-order" set exactly

  Scenario: The choice schema rejects an amount that is not one of the candidates
    Given deviceParseSchemaFor a "choice" amount plan
    When its validate function is called with a valid output whose amount is "46"
    Then validation fails

  Scenario Outline: A schema-violating expense output is rejected by deviceParseSchemaFor's own validate
    Given deviceParseSchemaFor a "<plan>" amount plan
    When its validate function is called with a model output missing every required field
    Then validation fails

    Examples:
      | plan   |
      | model  |
      | single |
      | choice |

  Scenario Outline: A schema-satisfying expense output is accepted by deviceParseSchemaFor's own validate
    Given deviceParseSchemaFor a "<plan>" amount plan
    When its validate function is called with a complete, valid model output
    Then validation succeeds

    Examples:
      | plan   |
      | model  |
      | single |
      | choice |

  Scenario: A model output without the verdict is rejected
    Given deviceParseSchemaFor a "model" amount plan
    When its validate function is called with a valid output that omits isTransaction
    Then validation fails

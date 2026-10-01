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

  Scenario: The ordered JSON Schema carries "x-order" equal to DEVICE_PARSE_FIELD_ORDER by default
    When the ordered JSON Schema is derived with no explicit order
    Then its "x-order" equals DEVICE_PARSE_FIELD_ORDER

  Scenario: The ordered JSON Schema is otherwise byte-identical to the plain AI SDK conversion
    When the ordered JSON Schema is derived with no explicit order
    Then its "type" is "object"
    And its "properties" keys equal the "x-order" set exactly
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of deviceParseSchema

  Scenario: An explicit order overrides "x-order" without changing anything else
    When the ordered JSON Schema is derived with the order: pending, confidence, occurredOn, note, account, payee, category, currency, type, amount
    Then its "x-order" equals: pending, confidence, occurredOn, note, account, payee, category, currency, type, amount
    And its "type" is "object"
    And its "properties" keys equal the "x-order" set exactly
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of deviceParseSchema

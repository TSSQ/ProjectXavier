Feature: A generalised, pinned-field-order JSON Schema for every on-device call
  Review finding B1: the patched native schema parser
  (`AppleLLMSchemaParser.parseObjectSchema`, step 1a.5) builds a model's
  fields in the order given by an explicit "x-order" JSON Schema key, falling
  back to ALPHABETICAL order when one is absent. The expense parse contract
  pins its own measured order (`src/domain/deviceParseSchemaOrder.ts`), but
  the other four on-device calls in `src/features/ai/deviceParse.ts` (account
  create, account update, query tool selection, transaction-op selection)
  sent a bare zod schema and so were silently moved onto alphabetical order —
  the reverse of the order their prompts were authored against.
  `src/domain/orderedJsonSchema.ts`'s `orderedJsonSchema` fixes this for all
  four, pinning each to its own schema's declaration order by default.

  Scenario Outline: Each on-device caller's schema is pinned to its declaration order, and is otherwise unchanged
    When orderedJsonSchema is derived for the "<schema>" schema with no explicit order
    Then its "x-order" equals the "<schema>" schema's declaration order
    And its "type" is "object"
    And its "properties" keys equal the "x-order" set exactly
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of the "<schema>" schema

    Examples:
      | schema                      |
      | accountParseSchema          |
      | accountUpdateParseSchema    |
      | queryToolSelectionSchema    |
      | transactionOpSelectionSchema |

  Scenario Outline: An explicit order overrides "x-order" without changing anything else
    When orderedJsonSchema is derived for the "<schema>" schema with an explicit reversed order
    Then its "x-order" equals the reversed order
    And every key except "x-order" matches the AI SDK's own zodSchema conversion of the "<schema>" schema

    Examples:
      | schema                   |
      | accountParseSchema       |
      | queryToolSelectionSchema |

  Scenario: declarationOrder is an exact permutation of the schema's own keys
    When declarationOrder is computed for the "accountUpdateParseSchema" schema
    Then it names exactly the same set of fields as the schema's own keys, once each

  Scenario: A model output that violates the schema is rejected by the helper's own validate
    Given orderedJsonSchema derived for the "transactionOpSelectionSchema" schema
    When its validate function is called with { "op": "launch-the-missiles" }
    Then validation fails

  Scenario: A model output that satisfies the schema is accepted by the helper's own validate
    Given orderedJsonSchema derived for the "transactionOpSelectionSchema" schema
    When its validate function is called with { "op": "delete" }
    Then validation succeeds

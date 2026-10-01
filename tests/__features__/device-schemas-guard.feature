Feature: Every on-device generateObject call gets its schema from src/domain/deviceSchemas
  QA found that a `generateObject` call in `src/features/ai/deviceParse.ts`
  can be reverted from `orderedJsonSchema(...)`/a `deviceSchemas` export back
  to a bare zod schema (losing the pinned "x-order" — step 1a.5/review B1)
  without any test failing, because both are structurally valid `schema:`
  values. `deviceParse.ts` cannot itself be imported into this plain-node
  suite (it pulls in the @react-native-ai/apple TurboModule binding), so this
  guard reads it as TEXT and asserts every `generateObject` call's `schema:`
  argument is one of `src/domain/deviceSchemas.ts`'s named exports, and never
  a bare zod schema identifier.

  Scenario: Every generateObject call in deviceParse.ts is schema-guarded
    Given the source text of src/features/ai/deviceParse.ts
    When every generateObject call's "schema:" argument is extracted
    Then there are exactly 5 generateObject calls
    And every "schema:" argument is one of src/domain/deviceSchemas's named exports
    And no "schema:" argument is a bare zod schema identifier

  Scenario: The extractor itself catches a generateObject call whose opening brace is on its own line
    Given an inline fixture containing a generateObject call split across lines with a bare zod schema
    When every generateObject call's "schema:" argument is extracted from the fixture
    Then the extractor finds exactly 1 generateObject call in the fixture
    And its "schema:" argument is a bare zod schema identifier, which the main guard would reject

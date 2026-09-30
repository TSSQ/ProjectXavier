// Mac-side Swift probe of Apple Foundation Models, wired into the parse-eval
// harness (dev tooling — never ships, see docs/design/parse-eval-pipeline-spec.md
// and evals/README.md "Wiring the FM Swift probe"). Compiled by
// `evals/fm/build.sh`; the resulting `evals/fm/probe` binary is gitignored —
// only this source is committed.
//
// THE #1 RULE (same as evals/engines/run_node.mjs): this mirrors the app's
// REAL on-device parse contract, never a re-implementation of its own.
//
// Step 1a.2 (this file) closes the schema-path gap step 1a's probe left open
// (its header used to document it as a KNOWN GAP): the app never uses a
// static `@Generable` struct. `@react-native-ai/apple`'s `generateText`
// (ios/AppleLLMImpl.swift) converts the JSON Schema `generateObject` derives
// from the zod contract into a `DynamicGenerationSchema` via its own
// `AppleLLMSchemaParser`, and calls
// `session.respond(to:schema:includeSchemaInPrompt: true, options:)` on a
// session built from a `Transcript` (not the `LanguageModelSession { … }`
// closure initializer). This probe now does exactly that:
//
//   - `AppleLLMSchemaParser` and `AppleLLMError` below are vendored VERBATIM
//     from the installed `@react-native-ai/apple` binding (see the header on
//     each for the exact source file/version) — never hand-edited. A binding
//     upgrade that changes either is caught by `evals/fm/check-sync.mjs`,
//     which now diffs `AppleLLMSchemaParser` here against the copy in
//     `node_modules/@react-native-ai/apple/ios/AppleLLMImpl.swift` (whitespace-
//     normalized) instead of comparing prompt strings.
//   - The probe takes three inputs over stdin as one JSON object —
//     `{ "instructions": string, "prompt": string, "schema": <JSON Schema> }`
//     — built on the TS side (`evals/engines/run_node.mjs`'s `runFM`) from the
//     REAL `buildDeviceParseInstructions()`, `buildDeviceParsePrompt()`, and
//     the exact JSON Schema `generateObject` derives from `deviceParseSchema`
//     (traced in run_node.mjs's own comment — not guessed). This file no
//     longer hand-copies any prompt/schema string, so there is nothing left
//     for the OLD check-sync (a string comparison) to guard — replaced as
//     above.
//   - The session is built the same way `AppleLLMImpl.swift`'s
//     `generateText` builds it: a `Transcript` with one `.instructions` entry
//     (the `instructions` string), then
//     `LanguageModelSession(model:tools:transcript:)` — NOT the
//     `LanguageModelSession { instructions }` closure initializer step 1a's
//     probe used.
//   - `session.respond(to:schema:includeSchemaInPrompt:options:)` is called
//     with a `GenerationSchema` built from the JSON Schema via
//     `AppleLLMSchemaParser.createGenerationSchema`, exactly as the app does —
//     never `respond(to:generating:)` against a compiled `@Generable` type.
//
// Usage: probe reads one JSON object from stdin:
//   { "instructions": "...", "prompt": "...", "schema": { ... },
//     "fixedOrder": ["field", ...] }
// `fixedOrder` is OPTIONAL, dev-only (never used by the committed eval
// pipeline): an explicit property-name order to force the schema's
// properties into, for the field-order replay experiment
// (`evals/fm/replay-orders.mjs`) — see "Fixed-order mode" below. When
// absent, behaviour is byte-for-byte identical to the field-order-agnostic
// path this probe has always run.
// Prints the model's RAW generated text to stdout on success — the exact
// string the app's own binding hands to JS (see "Raw output" below) —
// never a probe-reconstructed dict. `run_node.mjs`'s `attempt()` does
// `JSON.parse` + `deviceParseSchema.parse(...)` on it, mirroring `ai`'s own
// `safeParseJSON` + zod-validate step inside `generateObject` exactly — so a
// malformed/unparseable response is a THROW on the Node side (caught and
// counted as a failed attempt by `runDeviceParseAttempts`, never a
// probe-side harness fault) — see run_node.mjs's `attempt()` for the mirror.
//
// Exit codes (model errors vs harness faults):
//   0  success — the model's raw generated text is on stdout.
//   1  HARNESS fault: bad args/stdin (missing/malformed JSON, missing
//      instructions/prompt/schema), the schema itself failed to convert to a
//      `GenerationSchema` (`AppleLLMSchemaParser` threw), or Foundation
//      Models is unavailable on this machine. `runFM` (run_node.mjs) turns
//      this into `status: 'error'` for the case.
//   2  MODEL/generation error: `session.respond` threw (guardrail violation,
//      generation failure), or no text could be extracted from the response
//      transcript at all (mirrors `ai`'s `NoObjectGeneratedError`, thrown
//      when `extractTextContent` finds nothing). This mirrors the app's own
//      `generateObject` throw — `runFM` swallows it exactly the way
//      `deviceParse.ts`'s retry loop does (see
//      `src/domain/deviceParseAttempts.ts`), counting it as a failed attempt,
//      never as `status: 'error'`.
//
// Raw output: rather than reading `GeneratedContent`'s typed properties
// one-by-one (which would
// need a probe edit every time the schema's field set changes), the probe
// mirrors `AppleLLMImpl.swift`'s `LanguageModelSession.Response.toModelMessages()`
// exactly: walk `response.transcriptEntries`, and for every `.response`
// entry take `String(describing: segments.last!)` — the literal string the
// binding puts in the RN bridge message it resolves `generateText(...)`
// with, and therefore the literal string `ai`'s `generateObject` JSON.parses
// on the JS side (`ai-sdk.js`'s `doGenerate` → `extractTextContent` →
// `safeParseJSON`). Verified NOT interchangeable with `GeneratedContent`'s
// own `.jsonString` accessor — a real on-device call produced the same
// key/value content through both but in a DIFFERENT key order, so only
// `String(describing:)` is provably the string the app's JS side actually
// receives.
//
// Diagnostics: Swift `Dictionary` iteration order is randomized PER CAST, not
// just per process — two independent `schemaDict["properties"] as?
// [String: Any]` casts of the exact same `Any` value can yield DIFFERENT key
// orders within the same process (a scratch repro is described in the commit
// that established this — an earlier claim that "same dictionary, same
// process hash seed ⇒ same order" does not hold). The app's own RN bridge
// hands `AppleLLMImpl.swift`'s `generateText` a FRESH bridged `[String:
// Any]` on every single real call too, so the app's field order is exactly
// this unstable per-call, not merely per-launch.
//
// The fix: log the order from what ACTUALLY reached `session.respond` —
// `GenerationSchema` is `Codable`/`CustomDebugStringConvertible`, and its
// `debugDescription` (verified: valid JSON, parseable with
// `JSONSerialization`) includes an `"x-order"` array that is exactly the
// `DynamicGenerationSchema.Property` array order `AppleLLMSchemaParser`
// built — the one, single cast `parseObjectSchema` itself performed, not a
// second independent one. `logGenerationSchemaPropertyOrder` below extracts
// it from the REAL `generationSchema` instance right after
// `AppleLLMSchemaParser.createGenerationSchema` builds it, so there is no
// way for the logged order to diverge from what the parser actually did.
//
// Sampling: `GenerationOptions(sampling: .greedy)`, matching the app's real
// binding — `AppleLLMImpl.swift`'s `createGenerationOptions` defaults
// `samplingMode` to `.greedy` whenever the caller (deviceParse.ts's
// `generateObject` call) doesn't set `topP`/`topK`, which it never does.
//
// Fixed-order mode (dev-only, `evals/fm/replay-orders.mjs`): the vendored
// `AppleLLMSchemaParser.parseObjectSchema` above iterates
// `schemaDict["properties"] as? [String: Any]`, a Swift `Dictionary` — which
// has no concept of order at all, so there is no way to force a specific
// property order through that exact code path. When stdin carries a
// `fixedOrder` array, this probe instead builds the top-level object's
// `DynamicGenerationSchema.Property` array by iterating `fixedOrder`
// directly (`parseObjectSchemaFixedOrder` below, MARK "Fixed-order mode"),
// calling the vendored `AppleLLMSchemaParser.parseDynamicSchema` for each
// property's own nested schema so every per-field type/guide/required rule
// still runs through the exact vendored logic — only the property
// ARRAY-BUILDING loop itself is order-driven instead of Dictionary-driven.
// The vendored struct itself is never modified. `logGenerationSchemaPropertyOrder`
// (below) still logs the order actually reached `session.respond` from the
// real `GenerationSchema.debugDescription`'s `"x-order"`, so a run can
// verify the forcing worked.

import Foundation
import FoundationModels

// MARK: - Vendored from @react-native-ai/apple ios/AppleLLMError.swift
// (installed version: see node_modules/@react-native-ai/apple/package.json,
// "version": "0.12.0" at the time this was vendored). Copied verbatim so
// `AppleLLMSchemaParser` below (which throws `AppleLLMError.invalidSchema`)
// compiles unchanged — NOT itself covered by check-sync.mjs's diff guard
// (only `AppleLLMSchemaParser` is); a drift here would only change an error
// MESSAGE the probe reports on a harness fault, never the schema/prompt
// contract itself.
enum AppleLLMError: Error, LocalizedError {
  case modelUnavailable
  case unsupportedOS
  case generationError(String)
  case streamNotFound(String)
  case invalidMessage(String)
  case conflictingSamplingMethods
  case invalidSchema(String)
  case toolCallError(Error)
  case unknownToolCallError

  var errorDescription: String? {
    switch self {
    case .modelUnavailable:
      return "Apple Intelligence model is not available"
    case .unsupportedOS:
      return "Apple Intelligence not available on this iOS version"
    case .generationError(let message):
      return "Generation error: \(message)"
    case .streamNotFound(let id):
      return "Stream with ID \(id) not found"
    case .invalidMessage(let role):
      return "Invalid message role '\(role)'. Supported roles are: system, user, assistant"
    case .conflictingSamplingMethods:
      return "Cannot specify both topP and topK parameters simultaneously. Please use only one sampling method."
    case .invalidSchema(let message):
      return "Invalid schema: \(message)"
    case .toolCallError(let error):
      return "Error calling tool: \(error.localizedDescription)"
    case .unknownToolCallError:
      return "Unknown tool call error"
    }

  }

  var code: Int {
    switch self {
    case .modelUnavailable: return 1
    case .unsupportedOS: return 2
    case .generationError: return 3
    case .streamNotFound: return 4
    case .invalidMessage: return 5
    case .conflictingSamplingMethods: return 6
    case .invalidSchema: return 7
    case .unknownToolCallError: return 8
    case .toolCallError: return 9
    }
  }
}

// MARK: - Vendored from @react-native-ai/apple ios/AppleLLMImpl.swift
// (installed version: see node_modules/@react-native-ai/apple/package.json,
// "version": "0.12.0" — the `AppleLLMSchemaParser` struct, verbatim, from
// inside `AppleLLMImpl`'s `// MARK: - Private Methods` section). This is the
// EXACT code the app's own binding runs to turn `generateObject`'s JSON
// Schema into a `DynamicGenerationSchema`/`GenerationSchema` — copied rather
// than reimplemented so this probe can never subtly diverge from it.
// `evals/fm/check-sync.mjs` fails the build if this block (whitespace-
// normalized) no longer matches the installed binding's copy, so a binding
// upgrade that changes schema-conversion behaviour is caught here, not
// silently missed. DO NOT hand-edit this block — if the binding's parser
// changes, re-vendor it here verbatim and update the version note above.
@available(iOS 26, *)
struct AppleLLMSchemaParser {
  static func createGenerationSchema(from schemaDict: [String: Any]) throws -> GenerationSchema {
    let dynamicSchemas = try parseDynamicSchema(from: schemaDict)
    return try GenerationSchema(root: dynamicSchemas, dependencies: [])
  }

  static func parseDynamicSchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    let type = schemaDict["type"] as? String

    if let anyOfArray = schemaDict["anyOf"] as? [[String: Any]] {
      let parsedSchemas = try anyOfArray.map { try parseDynamicSchema(from: $0) }
      return DynamicGenerationSchema(
        name: schemaDict["title"] as? String ?? "",
        description: schemaDict["description"] as? String,
        anyOf: parsedSchemas
      )
    }

    switch type {
    case "object":
      return try parseObjectSchema(from: schemaDict)
    case "array":
      return try parseArraySchema(from: schemaDict)
    case "string":
      return try parseStringSchema(from: schemaDict)
    case "number", "integer":
      return try parseNumberSchema(from: schemaDict)
    case "boolean":
      return try parseBooleanSchema(from: schemaDict)
    default:
      throw AppleLLMError.invalidSchema("Unsupported schema type: \(type ?? "unknown"). Supported types: object, array, string, number, integer, boolean")
    }
  }

  static func parseObjectSchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    var properties: [DynamicGenerationSchema.Property] = []

    if let propertiesDict = schemaDict["properties"] as? [String: Any] {
      let requiredFields = schemaDict["required"] as? [String] ?? []

      for (propertyName, propertySchema) in propertiesDict {
        guard let propertySchemaDict = propertySchema as? [String: Any] else {
          throw AppleLLMError.invalidSchema("Property \(propertyName) schema must be an object")
        }

        let isOptional = !requiredFields.contains(propertyName)
        let propertyDescription = propertySchemaDict["description"] as? String

        let nestedSchema = try parseDynamicSchema(from: propertySchemaDict)

        let property = DynamicGenerationSchema.Property(
          name: propertyName,
          description: propertyDescription,
          schema: nestedSchema,
          isOptional: isOptional
        )
        properties.append(property)
      }
    }

    return DynamicGenerationSchema(
      name: schemaDict["title"] as? String ?? "",
      description: schemaDict["description"] as? String,
      properties: properties
    )
  }

  static func parseArraySchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    guard let itemsSchema = schemaDict["items"] as? [String: Any] else {
      throw AppleLLMError.invalidSchema("Array schema must have items definition")
    }

    let itemDynamicSchema = try parseDynamicSchema(from: itemsSchema)

    let minItems = schemaDict["minItems"] as? Int
    let maxItems = schemaDict["maxItems"] as? Int

    return DynamicGenerationSchema(
      arrayOf: itemDynamicSchema,
      minimumElements: minItems,
      maximumElements: maxItems
    )
  }

  static func parseStringSchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    // Handle enum values
    if let enumValues = schemaDict["enum"] as? [String] {
      return DynamicGenerationSchema(type: String.self, guides: [GenerationGuide.anyOf(enumValues)])
    }

    // Handle regular expressions
    if let pattern = schemaDict["pattern"] as? String {
      do {
        let regex = try Regex(pattern)
        return DynamicGenerationSchema(type: String.self, guides: [
          GenerationGuide.pattern(regex)
        ])
      } catch {
        throw AppleLLMError.invalidSchema("Invalid regex pattern '\(pattern)': \(error.localizedDescription)")
      }
    }

    return DynamicGenerationSchema(type: String.self, guides: [])
  }

  static func parseNumberSchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    let type = schemaDict["type"] as! String

    // Handle numeric enums - use string representation since Apple's GenerationGuide.anyOf only supports [String]
    // The JavaScript side will parse these back to numbers after generation

    if let enumValues = schemaDict["enum"] as? [String] {
      return DynamicGenerationSchema(type: String.self, guides: [GenerationGuide.anyOf(enumValues)])
    }

    if schemaDict["multipleOf"] != nil {
      throw AppleLLMError.invalidSchema("MultipleOf is not supported by Apple Foundational models.")
    }

    if let maximum = schemaDict["maximum"] as? Double {
      if type == "integer" {
        return DynamicGenerationSchema(type: Int.self, guides: [GenerationGuide.maximum(Int(maximum))])
      } else {
        return DynamicGenerationSchema(type: Double.self, guides: [GenerationGuide.maximum(maximum)])
      }
    }

    if let minimum = schemaDict["minimum"] as? Double {
      if type == "integer" {
        return DynamicGenerationSchema(type: Int.self, guides: [GenerationGuide.minimum(Int(minimum))])
      } else {
        return DynamicGenerationSchema(type: Double.self, guides: [GenerationGuide.minimum(minimum)])
      }
    }

    // Apple's GenerationGuide only supports inclusive bounds (≤, ≥)
    // We convert exclusive bounds (< , >) to the nearest inclusive equivalent:
    // - exclusiveMaximum: value < N → maximum(N-1 for int, N.nextDown for double)
    // - exclusiveMinimum: value > N → minimum(N+1 for int, N.nextUp for double)

    if let exclusiveMaximum = schemaDict["exclusiveMaximum"] as? Double {
      if type == "integer" {
        let approximateMax = Int(exclusiveMaximum) - 1
        return DynamicGenerationSchema(type: Int.self, guides: [GenerationGuide.maximum(approximateMax)])
      } else {
        let approximateMax = exclusiveMaximum.nextDown
        return DynamicGenerationSchema(type: Double.self, guides: [GenerationGuide.maximum(approximateMax)])
      }
    }

    if let exclusiveMinimum = schemaDict["exclusiveMinimum"] as? Double {
      if type == "integer" {
        let approximateMin = Int(exclusiveMinimum) + 1
        return DynamicGenerationSchema(type: Int.self, guides: [GenerationGuide.minimum(approximateMin)])
      } else {
        let approximateMin = exclusiveMinimum.nextUp
        return DynamicGenerationSchema(type: Double.self, guides: [GenerationGuide.minimum(approximateMin)])
      }
    }

    if type == "integer" {
      return DynamicGenerationSchema(type: Int.self, guides: [])
    } else {
      return DynamicGenerationSchema(type: Double.self, guides: [])
    }
  }

  static func parseBooleanSchema(from schemaDict: [String: Any]) throws -> DynamicGenerationSchema {
    return DynamicGenerationSchema(type: Bool.self, guides: [])
  }


}

// MARK: - Fixed-order mode (probe-only glue, not vendored — see the file
// header's "Fixed-order mode" section). NOT used by the committed eval
// pipeline; only `evals/fm/replay-orders.mjs` sends `fixedOrder`. Never
// modifies `AppleLLMSchemaParser` above — it calls straight into its
// `parseDynamicSchema` for every property's own nested schema, and only
// replaces the top-level object's Dictionary-driven property loop (which
// cannot express an order at all) with one driven by the explicit
// `fixedOrder` array.
private enum FixedOrderSchemaError: Error, LocalizedError {
  case unknownProperty(String)
  case notAnObjectSchema

  var errorDescription: String? {
    switch self {
    case .unknownProperty(let name):
      return "fixedOrder names a property not in schema.properties: \(name)"
    case .notAnObjectSchema:
      return "fixedOrder was given but schema has no \"properties\" object"
    }
  }
}

private func parseObjectSchemaFixedOrder(
  from schemaDict: [String: Any],
  order: [String]
) throws -> DynamicGenerationSchema {
  guard let propertiesDict = schemaDict["properties"] as? [String: Any] else {
    throw FixedOrderSchemaError.notAnObjectSchema
  }
  let requiredFields = schemaDict["required"] as? [String] ?? []

  var properties: [DynamicGenerationSchema.Property] = []
  for propertyName in order {
    guard let propertySchema = propertiesDict[propertyName],
          let propertySchemaDict = propertySchema as? [String: Any]
    else {
      throw FixedOrderSchemaError.unknownProperty(propertyName)
    }
    let isOptional = !requiredFields.contains(propertyName)
    let propertyDescription = propertySchemaDict["description"] as? String
    // Same nested-type resolution as the real, vendored parser — only the
    // property array's ORDER differs.
    let nestedSchema = try AppleLLMSchemaParser.parseDynamicSchema(from: propertySchemaDict)
    properties.append(
      DynamicGenerationSchema.Property(
        name: propertyName,
        description: propertyDescription,
        schema: nestedSchema,
        isOptional: isOptional
      )
    )
  }

  return DynamicGenerationSchema(
    name: schemaDict["title"] as? String ?? "",
    description: schemaDict["description"] as? String,
    properties: properties
  )
}

// MARK: - Probe-only glue (not vendored — this is the harness's own code)

private func writeStderr(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

private func fail(_ message: String, code: Int32) -> Never {
  writeStderr(message)
  exit(code)
}

private struct ProbeInput {
  let instructions: String
  let prompt: String
  let schema: [String: Any]
  // Dev-only, optional — see the file header's "Fixed-order mode" section.
  // `nil` (the normal/shipping-fidelity path) whenever the key is absent.
  let fixedOrder: [String]?
}

/// Reads and validates the one stdin JSON object. Any failure here is a
/// HARNESS fault (bad args/bad JSON) — exit 1.
private func readProbeInput() -> ProbeInput {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard !data.isEmpty else {
    fail("no input on stdin — expected {\"instructions\",\"prompt\",\"schema\"}", code: 1)
  }
  guard let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
    fail("stdin is not a JSON object", code: 1)
  }
  guard let instructions = top["instructions"] as? String else {
    fail("missing/non-string \"instructions\" in stdin JSON", code: 1)
  }
  guard let prompt = top["prompt"] as? String else {
    fail("missing/non-string \"prompt\" in stdin JSON", code: 1)
  }
  guard let schema = top["schema"] as? [String: Any] else {
    fail("missing/non-object \"schema\" in stdin JSON", code: 1)
  }
  let fixedOrder = top["fixedOrder"] as? [String]
  return ProbeInput(instructions: instructions, prompt: prompt, schema: schema, fixedOrder: fixedOrder)
}

/// Logs the property order the REAL `generationSchema` (the one just built
/// by `AppleLLMSchemaParser.createGenerationSchema`, the one actually handed
/// to `session.respond`) carries — extracted from `GenerationSchema`'s own
/// `debugDescription` (valid JSON; the framework includes an `"x-order"`
/// array recording exactly the `DynamicGenerationSchema.Property` array
/// order the parser built, verified via a scratch repro — see the file
/// header's "Diagnostics" section).
///
/// `GenerationSchema` is also `Codable` — checked (scratch repro,
/// not committed) whether `JSONEncoder().encode(schema)` exposes this order
/// more reliably than `debugDescription`. It does not: across 5 shuffled-
/// input trials, `JSONEncoder`'s output was BYTE-IDENTICAL to
/// `debugDescription`'s (both are the same underlying JSON, including the
/// same reliable `"x-order"` key and the same UNRELIABLE per-cast
/// `"properties"` dict key order this whole diagnostic exists to avoid).
/// Codable buys nothing here, so `debugDescription` stays — it's already
/// what the probe parses and needs no extra `Encodable` conformance
/// reasoning.
///
/// Best-effort: a missing/unparseable `"x-order"` logs a fallback note
/// rather than crashing the probe, since this is a diagnostic, never
/// required for a valid parse. The fallback uses a DISTINCT line prefix
/// ("schema property order UNAVAILABLE:", not "schema property order: ")
/// so `run_node.mjs`'s success-line regex (`^schema property
/// order: (.+)$`) can never mistake this fallback sentence for a real,
/// comma-separated order array; `run_node.mjs` matches this prefix
/// separately to count/warn on unavailability instead.
private func logGenerationSchemaPropertyOrder(_ schema: GenerationSchema) {
  guard let data = schema.debugDescription.data(using: .utf8),
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let order = obj["x-order"] as? [String]
  else {
    writeStderr("schema property order UNAVAILABLE: could not extract \"x-order\" from GenerationSchema.debugDescription")
    return
  }
  writeStderr("schema property order: \(order.joined(separator: ", "))")
}

/// Mirrors `AppleLLMImpl.swift`'s `LanguageModelSession.Response.toModelMessages()`
/// + `ai`'s own `extractTextContent` (node_modules/ai/dist/index.js): walk
/// every `.response` transcript entry (in order) and concatenate
/// `String(describing: segments.last!)` for each — exactly the text the
/// app's real binding resolves `generateText(...)` with, and therefore
/// exactly the string `generateObject`'s `safeParseJSON` parses on the JS
/// side. Returns `nil` when no `.response` entry produced any text at all
/// (mirrors `ai`'s `NoObjectGeneratedError` — "the model did not return a
/// response").
private func extractRawModelText(from response: LanguageModelSession.Response<GeneratedContent>) -> String? {
  var parts: [String] = []
  for entry in response.transcriptEntries {
    if case .response(let r) = entry, let last = r.segments.last {
      parts.append(String(describing: last))
    }
  }
  return parts.isEmpty ? nil : parts.joined()
}

// MARK: - CLI entry point

@main
struct Probe {
  static func main() async {
    let input = readProbeInput()

    switch SystemLanguageModel.default.availability {
    case .available:
      break
    case .unavailable(let reason):
      fail("Foundation Models unavailable: \(reason)", code: 1)
    }

    let generationSchema: GenerationSchema
    do {
      if let fixedOrder = input.fixedOrder {
        // Dev-only fixed-order mode — see the file header's "Fixed-order
        // mode" section. Never touches `AppleLLMSchemaParser`; when
        // `fixedOrder` is absent (the normal path, taken on every real
        // shipping call this probe otherwise mirrors), this branch never
        // runs and behaviour is byte-for-byte identical to before.
        let dynamicSchema = try parseObjectSchemaFixedOrder(from: input.schema, order: fixedOrder)
        generationSchema = try GenerationSchema(root: dynamicSchema, dependencies: [])
      } else {
        generationSchema = try AppleLLMSchemaParser.createGenerationSchema(from: input.schema)
      }
    } catch {
      fail("invalid schema: \(error)", code: 1)
    }

    // Logged from the REAL generationSchema instance — see the file header's
    // "Diagnostics" section and this function's own doc comment.
    logGenerationSchemaPropertyOrder(generationSchema)

    // Mirrors AppleLLMImpl.swift's createTranscriptAndPrompt + generateText:
    // the "system" message becomes a single `.instructions` transcript entry,
    // the session is built from THAT transcript (not the closure-based
    // `LanguageModelSession { instructions }` initializer), and the "user"
    // message is the `respond(to:...)` prompt argument.
    let instructionsEntry = Transcript.Entry.instructions(
      Transcript.Instructions(
        segments: [.text(.init(content: input.instructions))],
        toolDefinitions: []
      )
    )
    let session = LanguageModelSession(
      model: SystemLanguageModel.default,
      tools: [],
      transcript: Transcript(entries: [instructionsEntry])
    )

    // .greedy — matches the app's real binding default (see the header note
    // above). No topP/topK is ever set by deviceParse.ts's generateObject
    // call, so AppleLLMImpl.swift's createGenerationOptions always resolves
    // to greedy sampling.
    let generationOptions = GenerationOptions(sampling: .greedy)

    let response: LanguageModelSession.Response<GeneratedContent>
    do {
      // Exactly AppleLLMImpl.swift's real call:
      //   session.respond(to: userPrompt, schema: generationSchema,
      //                    includeSchemaInPrompt: true, options: generationOptions)
      response = try await session.respond(
        to: input.prompt,
        schema: generationSchema,
        includeSchemaInPrompt: true,
        options: generationOptions
      )
    } catch {
      // A guardrail violation or any other generation failure — mirrors the
      // app's own `generateObject` throw. MODEL error, not a harness fault.
      fail("generation failed: \(error)", code: 2)
    }

    // Raw output (see the file header's "Raw output" section): the exact
    // string the app's own binding would hand to JS, printed
    // unconditionally — no probe-side JSON re-encoding, no per-field
    // decoding, so a schema field being added/renamed/dropped never needs a
    // probe edit. run_node.mjs's attempt() does the JSON.parse + zod
    // validation, mirroring `ai`'s own safeParseJSON + validate step.
    guard let rawText = extractRawModelText(from: response) else {
      // Mirrors `ai`'s NoObjectGeneratedError ("the model did not return a
      // response") — a generation failure, not a harness fault.
      fail("generation failed: no text in the response transcript", code: 2)
    }
    FileHandle.standardOutput.write(rawText.data(using: .utf8)!)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  }
}

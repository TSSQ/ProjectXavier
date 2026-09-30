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
//   { "instructions": "...", "prompt": "...", "schema": { ... } }
// Prints one JSON object (the raw `GeneratedContent`, field names matching
// `deviceParseSchema`) to stdout on success.
//
// Exit codes (review B2 / QA — model errors vs harness faults):
//   0  success — the parse-shaped JSON object is on stdout.
//   1  HARNESS fault: bad args/stdin (missing/malformed JSON, missing
//      instructions/prompt/schema), the schema itself failed to convert to a
//      `GenerationSchema` (`AppleLLMSchemaParser` threw), or Foundation
//      Models is unavailable on this machine. `runFM` (run_node.mjs) turns
//      this into `status: 'error'` for the case.
//   2  MODEL/generation error: `session.respond` threw (guardrail violation,
//      generation failure) or `GeneratedContent`'s typed property decoding
//      failed. This mirrors the app's own `generateObject` throw — `runFM`
//      swallows it exactly the way `deviceParse.ts`'s retry loop does (see
//      `src/domain/deviceParseAttempts.ts`), counting it as a failed attempt,
//      never as `status: 'error'`.
//
// Diagnostics: Swift `Dictionary` iteration order is randomized per process
// (review found `AppleLLMSchemaParser.parseObjectSchema` iterates
// `propertiesDict`, a `[String: Any]`) — so the app's own field order inside
// the generated `DynamicGenerationSchema`, and therefore what
// `includeSchemaInPrompt: true` injects into the prompt text, may differ
// between launches. This probe logs that order to stderr on every call by
// independently iterating the SAME `schema["properties"]` dictionary value
// the vendored parser below iterates (same dictionary, same process hash
// seed ⇒ same order) — done here rather than inside the vendored block so
// that block stays byte-for-byte identical to the binding's own source.
//
// Sampling: `GenerationOptions(sampling: .greedy)`, matching the app's real
// binding — `AppleLLMImpl.swift`'s `createGenerationOptions` defaults
// `samplingMode` to `.greedy` whenever the caller (deviceParse.ts's
// `generateObject` call) doesn't set `topP`/`topK`, which it never does.

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
  return ProbeInput(instructions: instructions, prompt: prompt, schema: schema)
}

/// Logs the order `AppleLLMSchemaParser.parseObjectSchema` will iterate the
/// schema's top-level properties in — by independently iterating the SAME
/// `[String: Any]` dictionary value, which (same process, same dictionary)
/// produces the identical order Swift's randomized-per-process hashing would
/// give the vendored parser, without touching that vendored block. See the
/// file header's "Diagnostics" section.
private func logSchemaPropertyOrder(_ schema: [String: Any]) {
  let properties = (schema["properties"] as? [String: Any]) ?? [:]
  let order = Array(properties.keys)
  writeStderr("schema property order: \(order.joined(separator: ", "))")
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

    logSchemaPropertyOrder(input.schema)

    let generationSchema: GenerationSchema
    do {
      generationSchema = try AppleLLMSchemaParser.createGenerationSchema(from: input.schema)
    } catch {
      fail("invalid schema: \(error)", code: 1)
    }

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

    let content: GeneratedContent
    do {
      // Exactly AppleLLMImpl.swift's real call:
      //   session.respond(to: userPrompt, schema: generationSchema,
      //                    includeSchemaInPrompt: true, options: generationOptions)
      let response = try await session.respond(
        to: input.prompt,
        schema: generationSchema,
        includeSchemaInPrompt: true,
        options: generationOptions
      )
      content = response.content
    } catch {
      // A guardrail violation or any other generation failure — mirrors the
      // app's own `generateObject` throw. MODEL error, not a harness fault.
      fail("generation failed: \(error)", code: 2)
    }

    do {
      var dict: [String: Any] = [
        "amount": try content.value(Double.self, forProperty: "amount"),
        "type": try content.value(String.self, forProperty: "type"),
        "category": try content.value(String.self, forProperty: "category"),
        "payee": try content.value(String.self, forProperty: "payee"),
        "account": try content.value(String.self, forProperty: "account"),
        "note": try content.value(String.self, forProperty: "note"),
        "confidence": try content.value(Double.self, forProperty: "confidence"),
        "pending": try content.value(Bool.self, forProperty: "pending"),
      ]
      if let currency = try content.value(String?.self, forProperty: "currency") {
        dict["currency"] = currency
      }
      if let occurredOn = try content.value(String?.self, forProperty: "occurredOn") {
        dict["occurredOn"] = occurredOn
      }

      let jsonData = try JSONSerialization.data(withJSONObject: dict)
      FileHandle.standardOutput.write(jsonData)
      FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    } catch {
      // The model's GeneratedContent didn't decode into the shape the schema
      // promised — a generation/decoding failure, same bucket as a `respond`
      // throw (exit 2), not a harness fault.
      fail("decoding failed: \(error)", code: 2)
    }
  }
}

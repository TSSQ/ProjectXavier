import ExpoModulesCore
import Vision

/// On-device OCR for photographed receipts, backed by Apple Vision. Only the
/// recognized *text* ever leaves this module — no image and no text is sent
/// anywhere by this file; see the boundary rationale in
/// src/features/ocr/recognizer.ts for why that split exists.
///
/// Stateless by design: every call builds its own `VNImageRequestHandler`, so
/// two overlapping calls (the JS side guards against this with `busy`, but
/// this module must hold up even if that guard is ever bypassed) can't share
/// or corrupt state.
public class AppleOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleOcr")

    // AsyncFunction bodies run on ExpoModulesCore's shared background queue,
    // not the main thread — required here since `.accurate` recognition is
    // CPU-heavy.
    AsyncFunction("recognizeText") { (uri: String) throws -> String in
      try recognizeText(atFileUri: uri)
    }

    // Statement-scan path (docs/design/statement-scan-spec.md §4.1) — same
    // request configuration as recognizeText above (.accurate, language
    // correction, no orientation override) so the two functions see the
    // same text; this one also returns each observation's bounding box,
    // converted to top-left origin, so the TS side can reconstruct rows from
    // geometry instead of Vision's column-major reading order.
    AsyncFunction("recognizeObservations") { (uri: String) throws -> [[String: Any]] in
      try recognizeObservations(atFileUri: uri)
    }
  }
}

private func recognizeText(atFileUri uri: String) throws -> String {
  guard let url = URL(string: uri), url.isFileURL else {
    throw AppleOcrInvalidUriException(uri)
  }

  // No orientation option is passed: VNImageRequestHandler(url:) reads EXIF
  // orientation from the file itself, and HEIC (the default iPhone camera
  // format) is handled natively — no manual rotation/conversion needed.
  let handler = VNImageRequestHandler(url: url, options: [:])

  var recognizedText = ""
  var recognitionError: Error?

  let request = VNRecognizeTextRequest { request, error in
    if let error {
      recognitionError = error
      return
    }
    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    // Vision returns observations in natural (top-to-bottom) reading order
    // already; re-sorting by bounding box would scramble multi-column
    // receipts instead of preserving their layout. An empty result (no text
    // found) resolves to "" — the TS layer decides what that means for UX.
    recognizedText = observations
      .compactMap { $0.topCandidates(1).first?.string }
      .joined(separator: "\n")
  }
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  // For image (non-sequence) requests, perform(_:) is synchronous: the
  // completion handler above has already run by the time this call returns,
  // so reading recognizedText/recognitionError right after it is safe.
  try handler.perform([request])

  if let recognitionError {
    throw recognitionError
  }
  return recognizedText
}

/// Same request configuration as `recognizeText` above — see that function's
/// comments — but returns each observation's text alongside its bounding
/// box instead of joining everything into one string. Vision's
/// `boundingBox` is bottom-left-origin, normalised 0..1; this converts it to
/// top-left origin (x = minX, y = 1 - maxY, w = width, h = height) so the TS
/// side (src/domain/ocrObservation.ts, statementLayout.ts) never has to
/// reason about Vision's coordinate space.
private func recognizeObservations(atFileUri uri: String) throws -> [[String: Any]] {
  guard let url = URL(string: uri), url.isFileURL else {
    throw AppleOcrInvalidUriException(uri)
  }

  let handler = VNImageRequestHandler(url: url, options: [:])

  var results: [[String: Any]] = []
  var recognitionError: Error?

  let request = VNRecognizeTextRequest { request, error in
    if let error {
      recognitionError = error
      return
    }
    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    results = observations.compactMap { observation -> [String: Any]? in
      guard let text = observation.topCandidates(1).first?.string else { return nil }
      let box = observation.boundingBox
      // Clamp to 0...1 (reviewer MINOR 3) — Vision's boundingBox can run a
      // hair outside the unit square for a glyph right at the image edge,
      // which would otherwise fail ocrObservationsSchema (x/y/w/h are each
      // z.number().min(0).max(1)) and reject the WHOLE payload for one
      // edge observation. zod itself is unchanged — this only tightens what
      // the native side ever hands it.
      func clamp01(_ v: CGFloat) -> CGFloat { min(max(v, 0), 1) }
      return [
        "text": text,
        "x": clamp01(box.minX),
        "y": clamp01(1 - box.maxY),
        "w": clamp01(box.width),
        "h": clamp01(box.height),
      ]
    }
  }
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  try handler.perform([request])

  if let recognitionError {
    throw recognitionError
  }
  return results
}

// MINOR 6 (QA): shared by both recognizeText and recognizeObservations, so
// the message names neither function specifically — "AppleOcr.recognizeText
// expects…" was wrong whenever this actually threw from recognizeObservations.
internal final class AppleOcrInvalidUriException: GenericException<String> {
  override var reason: String {
    "AppleOcr expects a file:// image URI, got: \(param)"
  }
}

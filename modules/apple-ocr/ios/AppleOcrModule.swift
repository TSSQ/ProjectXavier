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

internal final class AppleOcrInvalidUriException: GenericException<String> {
  override var reason: String {
    "AppleOcr.recognizeText expects a file:// image URI, got: \(param)"
  }
}

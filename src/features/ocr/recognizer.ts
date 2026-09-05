/**
 * On-device OCR boundary.
 *
 * Receipt images are turned into text *on the device* (Apple Vision / ML Kit —
 * free, offline, and keeps the image off our servers), then only that text is
 * sent to the AI proxy. That single decision is what keeps AI parsing cheap
 * (text tokens, not vision tokens) and private.
 *
 * The recognizer is an injectable interface so the assistant flow and tests
 * never depend on a native module. The real iOS implementation is the local
 * Expo module `modules/apple-ocr` (Apple Vision), adapted in
 * `appleVisionRecognizer.ts` — always resolve it through `getRecognizer()`,
 * which falls back to `unconfiguredRecognizer` where the module isn't linked
 * (Android would get an ML Kit-backed implementation here later).
 */
import { OcrObservation } from '../../domain/ocrObservation';

export interface TextRecognizer {
  /** Extract plain text from a local image URI. */
  recognize(imageUri: string): Promise<string>;
  /** Extract text WITH normalised bounding boxes from a local image URI —
   *  the statement-scan path's input (docs/design/statement-scan-spec.md
   *  §4.1); `reconstructLayout` (src/domain/statementLayout.ts) turns the
   *  result into rows. Native output crosses a zod boundary (guardrail #6)
   *  before it ever reaches that pure geometry code — see
   *  appleVisionRecognizer.ts. */
  recognizeLayout(imageUri: string): Promise<OcrObservation[]>;
}

/**
 * Default recognizer used until a native OCR module is wired up. It fails
 * loudly rather than silently returning empty text, so a missing integration
 * surfaces immediately instead of producing a bad AI parse.
 */
export const unconfiguredRecognizer: TextRecognizer = {
  async recognize() {
    throw new Error(
      'OCR is not configured. Provide a TextRecognizer backed by a native ' +
        'text-recognition module (see src/features/ocr/recognizer.ts).'
    );
  },
  async recognizeLayout() {
    throw new Error(
      'OCR is not configured. Provide a TextRecognizer backed by a native ' +
        'text-recognition module (see src/features/ocr/recognizer.ts).'
    );
  },
};

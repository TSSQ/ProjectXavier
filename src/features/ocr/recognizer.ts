/**
 * On-device OCR boundary.
 *
 * Receipt images are turned into text *on the device* (Apple Vision / ML Kit —
 * free, offline, and keeps the image off our servers), then only that text is
 * sent to the AI proxy. That single decision is what keeps AI parsing cheap
 * (text tokens, not vision tokens) and private.
 *
 * The recognizer is an injectable interface so the assistant flow and tests
 * never depend on a native module. Wire the real implementation in the app via
 * a config plugin + dev build (e.g. `@react-native-ml-kit/text-recognition`),
 * which exposes `recognize(uri)` and maps cleanly onto `TextRecognizer`.
 */

export interface TextRecognizer {
  /** Extract plain text from a local image URI. */
  recognize(imageUri: string): Promise<string>;
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
};

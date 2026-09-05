import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppleOcrModule {
  /** Extract text from a local `file://` image URI via Apple Vision. */
  recognizeText(uri: string): Promise<string>;
  /** Extract text WITH normalised bounding boxes ({ text, x, y, w, h }[]) —
   *  docs/design/statement-scan-spec.md §4.1. Typed `unknown` on purpose: the
   *  boundary is validated with zod in appleVisionRecognizer.ts
   *  (ocrObservationsSchema), never trusted here. */
  recognizeObservations(uri: string): Promise<unknown>;
}

// Optional so importing this file never throws where the native module isn't
// linked (Android, Expo Go) — callers go through getRecognizer(), which only
// hands out the Vision recognizer when the module is actually present.
export default requireOptionalNativeModule<AppleOcrModule>('AppleOcr');

/**
 * Real on-device OCR adapter, backed by Apple Vision (see
 * modules/apple-ocr/ios/AppleOcrModule.swift for the native side). Kept thin
 * on purpose — all the recognition logic lives in the native module; this
 * file only adapts its shape to the `TextRecognizer` seam.
 */
import { Platform } from 'react-native';
import AppleOcr from '../../../modules/apple-ocr';
import { TextRecognizer, unconfiguredRecognizer } from './recognizer';
import { ocrObservationsSchema } from '../../domain/ocrObservation';

export const appleVisionRecognizer: TextRecognizer = {
  recognize: (uri) => {
    if (!AppleOcr) {
      // Same contract as unconfiguredRecognizer: fail loudly at call time.
      return Promise.reject(
        new Error('AppleOcr native module is not linked in this build.')
      );
    }
    return AppleOcr.recognizeText(uri);
  },
  recognizeLayout: async (uri) => {
    if (!AppleOcr) {
      return Promise.reject(
        new Error('AppleOcr native module is not linked in this build.')
      );
    }
    // The native module's output is `unknown` on purpose (modules/apple-ocr/
    // index.ts) — it crosses a trust boundary here (guardrail #6: OCR output
    // is untrusted) before any pure domain code (statementLayout.ts) sees
    // it. A rejected payload throws, same as a missing module above, so the
    // screen's existing "I couldn't read that photo" catch handles it —
    // never a crash, never silently-wrong geometry.
    const raw = await AppleOcr.recognizeObservations(uri);
    const result = ocrObservationsSchema.safeParse(raw);
    if (!result.success) {
      throw new Error('AppleOcr.recognizeObservations returned an invalid payload.');
    }
    return result.data;
  },
};

/**
 * The seam the app should call through: Apple Vision on iOS (today's only
 * shipping platform), `unconfiguredRecognizer` everywhere else — kept
 * explicit so adding a real Android recognizer later is a one-line change
 * here rather than a hunt through call sites.
 */
export function getRecognizer(): TextRecognizer {
  return Platform.OS === 'ios' && AppleOcr
    ? appleVisionRecognizer
    : unconfiguredRecognizer;
}

/**
 * Real on-device OCR adapter, backed by Apple Vision (see
 * modules/apple-ocr/ios/AppleOcrModule.swift for the native side). Kept thin
 * on purpose — all the recognition logic lives in the native module; this
 * file only adapts its shape to the `TextRecognizer` seam.
 */
import { Platform } from 'react-native';
import AppleOcr from '../../../modules/apple-ocr';
import { TextRecognizer, unconfiguredRecognizer } from './recognizer';

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

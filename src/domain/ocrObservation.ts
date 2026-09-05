/**
 * Native OCR observation boundary — the shape `AppleOcr.recognizeObservations`
 * (modules/apple-ocr/ios/AppleOcrModule.swift) returns, validated with zod
 * before anything downstream trusts it (guardrail #6: AI/OCR output is
 * untrusted). Boxes are Vision's `boundingBox`, already converted to
 * top-left origin on the native side (x = minX, y = 1 - maxY, w = width,
 * h = height) and normalised 0..1 against the image dimensions.
 *
 * Framework-free (no RN/Expo imports) so it's usable from both the native
 * adapter (src/features/ocr/appleVisionRecognizer.ts) and the plain-Node BDD
 * suite (docs/design/statement-scan-spec.md §4.1/§4.2).
 */
import { z } from 'zod';

export const ocrObservationSchema = z.object({
  text: z.string().max(500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/** Capped at 2000 — Vision realistically returns tens to low hundreds of
 *  observations per screenshot; the cap is a sanity bound against a
 *  malformed/adversarial native payload, not a real-world limit. */
export const ocrObservationsSchema = z.array(ocrObservationSchema).max(2000);

export type OcrObservation = z.infer<typeof ocrObservationSchema>;

/**
 * Classifies raw OCR output before it's handed to the parse ladder.
 *
 * Pure and framework-free on purpose: it's the one bit of `onScan`'s
 * OCR-result handling (app/(tabs)/index.tsx) worth pinning in the BDD suite,
 * so this lives in src/domain rather than inline in the screen. The native
 * recognizer itself (modules/apple-ocr, src/features/ocr) can't be imported
 * here or from tests — see src/features/ocr/recognizer.ts for that boundary.
 */

export type OcrOutcome =
  // Nothing usable — the recognizer found no text, or only whitespace. The
  // caller must show the "couldn't find any text" reply and NOT call runParse.
  | { kind: 'empty' }
  // Usable text. `text` is the trimmed recognizer output — runParse trims
  // again internally, but trimming here pins exactly what the caller passes
  // through, rather than leaving leading/trailing whitespace ambiguous.
  | { kind: 'ok'; text: string };

export function classifyOcrText(text: string): OcrOutcome {
  const trimmed = text.trim();
  return trimmed.length === 0 ? { kind: 'empty' } : { kind: 'ok', text: trimmed };
}

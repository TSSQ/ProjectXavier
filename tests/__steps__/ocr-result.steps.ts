import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { classifyOcrText, OcrOutcome } from '../../src/domain/ocrResult';

const feature = loadFeature(path.resolve(__dirname, '../__features__/ocr-result.feature'));

/** Feature-file step text can't carry a literal newline/tab, so scenarios
 *  write the escape sequence ("\n", "\t") and this unescapes it back to the
 *  real whitespace character before it reaches classifyOcrText. */
function unescapeWhitespace(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

defineFeature(feature, (test) => {
  let outcome: OcrOutcome;

  test('Empty string is classified as empty', ({ when, then }) => {
    when(/^I classify OCR text "(.*)"$/, (text: string) => {
      outcome = classifyOcrText(unescapeWhitespace(text));
    });
    then(/^the classification should be "(.*)"$/, (kind: string) => {
      expect(outcome.kind).toBe(kind);
    });
  });

  test('Whitespace-only text is classified as empty', ({ when, then }) => {
    when(/^I classify OCR text "(.*)"$/, (text: string) => {
      outcome = classifyOcrText(unescapeWhitespace(text));
    });
    then(/^the classification should be "(.*)"$/, (kind: string) => {
      expect(outcome.kind).toBe(kind);
    });
  });

  test('Text with surrounding whitespace is classified as ok, trimmed', ({
    when,
    then,
    and,
  }) => {
    when(/^I classify OCR text "(.*)"$/, (text: string) => {
      outcome = classifyOcrText(unescapeWhitespace(text));
    });
    then(/^the classification should be "(.*)"$/, (kind: string) => {
      expect(outcome.kind).toBe(kind);
    });
    and(/^the text handed to runParse should be "(.*)"$/, (expected: string) => {
      expect(outcome.kind === 'ok' ? outcome.text : null).toBe(expected);
    });
  });
});

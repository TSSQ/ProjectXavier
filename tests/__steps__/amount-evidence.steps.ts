import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { hasAmountEvidence } from '../../src/domain/deviceParsePrompt';

const feature = loadFeature(path.resolve(__dirname, '../__features__/amount-evidence.feature'));

defineFeature(feature, (test) => {
  test('Text that names an amount keeps the retry', ({ then }) => {
    then(/^"(.*)" should have amount evidence$/, (text: string) => expect(hasAmountEvidence(text)).toBe(true));
  });
  test('Text with no amount skips it', ({ then }) => {
    then(/^"(.*)" should have no amount evidence$/, (text: string) => expect(hasAmountEvidence(text)).toBe(false));
  });
  test('Accepted false positives keep the retry', ({ then }) => {
    then(/^"(.*)" should have amount evidence$/, (text: string) => expect(hasAmountEvidence(text)).toBe(true));
  });
});

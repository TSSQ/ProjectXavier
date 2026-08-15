import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(path.resolve(__dirname, '../__features__/transaction-op-routing.feature'));

const REPO_ROOT = path.resolve(__dirname, '../..');
const ASSISTANT_SCREEN = path.join(REPO_ROOT, 'app/(tabs)/index.tsx');

function assistantScreenSource(): string {
  return fs.readFileSync(ASSISTANT_SCREEN, 'utf8');
}

defineFeature(feature, (test) => {
  test('The assistant screen contains exactly one deleteTransaction( call site', ({ then }) => {
    then(/^the assistant screen source should contain exactly (\d+) occurrence of "(.*)"$/, (
      count: string,
      substring: string
    ) => {
      const source = assistantScreenSource();
      const occurrences = source.split(substring).length - 1;
      expect(occurrences).toBe(Number(count));
    });
  });

  test('The assistant screen still never imports or calls deleteAccountCascade', ({ then }) => {
    then(/^the assistant screen source should not reference "(.*)"$/, (symbol: string) => {
      expect(assistantScreenSource()).not.toContain(symbol);
    });
  });

  test('The assistant screen reuses the existing transaction repository primitives and form sheet', ({
    then,
    and,
  }) => {
    then(/^the assistant screen source should reference "(.*)"$/, (symbol: string) => {
      expect(assistantScreenSource()).toContain(symbol);
    });
    and(/^the assistant screen source should reference "(.*)"$/, (symbol: string) => {
      expect(assistantScreenSource()).toContain(symbol);
    });
  });
});

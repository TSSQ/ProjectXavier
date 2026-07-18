import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { maskApiKey } from '../../src/domain/byokKeyMask';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/byok-key-mask.feature')
);

defineFeature(feature, (test) => {
  test('A normal long key reveals exactly the last 4 characters', ({ when, then }) => {
    let key: string;
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      key = k;
      result = maskApiKey(key);
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('A key shorter than 8 characters is fully masked', ({ when, then }) => {
    let key: string;
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      key = k;
      result = maskApiKey(key);
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });

    then('the masked result should not contain any of the original characters', () => {
      for (const ch of key) {
        expect(result).not.toContain(ch);
      }
    });
  });

  test('A key exactly at the 8-character boundary reveals the last 4', ({ when, then }) => {
    let key: string;
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      key = k;
      result = maskApiKey(key);
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('The masked result is never equal to the original key', ({ when, then }) => {
    let key: string;
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      key = k;
      result = maskApiKey(key);
    });

    then('the masked result should not equal the original key', () => {
      expect(result).not.toBe(key);
    });
  });

  test('An empty key is fully masked without throwing', ({ when, then }) => {
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      expect(() => {
        result = maskApiKey(k);
      }).not.toThrow();
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('A null key is fully masked without throwing', ({ when, then }) => {
    let result: string;

    when('I mask a null key', () => {
      expect(() => {
        result = maskApiKey(null as unknown as string);
      }).not.toThrow();
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('An undefined key is fully masked without throwing', ({ when, then }) => {
    let result: string;

    when('I mask an undefined key', () => {
      expect(() => {
        result = maskApiKey(undefined as unknown as string);
      }).not.toThrow();
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('An emoji straddling the last-4 boundary is never split into a lone surrogate', ({
    when,
    then,
  }) => {
    let result: string;

    when(/^I mask the key "(.*)"$/, (k: string) => {
      result = maskApiKey(k);
    });

    then(/^the masked result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });

    then('the masked result should not contain an unpaired surrogate', () => {
      const unpairedSurrogate =
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      expect(unpairedSurrogate.test(result)).toBe(false);
    });
  });
});

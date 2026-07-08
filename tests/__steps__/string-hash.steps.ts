import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { stringHash, initialOf } from '../../src/lib/stringHash';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/string-hash.feature')
);

defineFeature(feature, (test) => {
  test('stringHash is deterministic for the same input', ({ given, when, then }) => {
    let name = '';
    let a = 0;
    let b = 0;

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I hash it twice', () => {
      a = stringHash(name);
      b = stringHash(name);
    });

    then('both hashes should be equal', () => {
      expect(a).toBe(b);
    });
  });

  test('stringHash is non-negative', ({ given, when, then }) => {
    let name = '';
    let hash = 0;

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I hash it', () => {
      hash = stringHash(name);
    });

    then('the hash should be non-negative', () => {
      expect(hash).toBeGreaterThanOrEqual(0);
    });
  });

  test('stringHash differs for different names (no collision for this pair)', ({
    given,
    when,
    then,
  }) => {
    let n1 = '';
    let n2 = '';
    let h1 = 0;
    let h2 = 0;

    given(/^the names "(.*)" and "(.*)"$/, (a: string, b: string) => {
      n1 = a;
      n2 = b;
    });

    when('I hash both', () => {
      h1 = stringHash(n1);
      h2 = stringHash(n2);
    });

    then('the hashes should differ', () => {
      expect(h1).not.toBe(h2);
    });
  });

  test('initialOf uppercases an alphabetic first letter', ({ given, when, then }) => {
    let name = '';
    let initial = '';

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I take the initial', () => {
      initial = initialOf(name);
    });

    then(/^the initial should be "(.*)"$/, (expected: string) => {
      expect(initial).toBe(expected);
    });
  });

  test('initialOf leaves a non-alphabetic first character as-is', ({
    given,
    when,
    then,
  }) => {
    let name = '';
    let initial = '';

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I take the initial', () => {
      initial = initialOf(name);
    });

    then(/^the initial should be "(.*)"$/, (expected: string) => {
      expect(initial).toBe(expected);
    });
  });

  test('initialOf leaves an emoji first character as-is', ({ given, when, then }) => {
    let name = '';
    let initial = '';

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I take the initial', () => {
      initial = initialOf(name);
    });

    then(/^the initial should be "(.*)"$/, (expected: string) => {
      expect(initial).toBe(expected);
    });
  });

  test('initialOf never returns an empty tile for a blank name', ({
    given,
    when,
    then,
  }) => {
    let name = '';
    let initial = '';

    given(/^the name "(.*)"$/, (n: string) => {
      name = n;
    });

    when('I take the initial', () => {
      initial = initialOf(name);
    });

    then(/^the initial should be "(.*)"$/, (expected: string) => {
      expect(initial).toBe(expected);
    });
  });
});

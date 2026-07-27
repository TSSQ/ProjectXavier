import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, Payee, TransactionType } from '../../src/domain/types';
import { localParse } from '../../src/domain/localParse';
import { AiParsedExpense } from '../../src/lib/validation';
import { nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/local-parse.feature')
);

const NOW = Date.UTC(2026, 0, 1);

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let payees: Payee[] = [];
  let parsed: AiParsedExpense;

  beforeEach(() => {
    categories = [];
    payees = [];
  });

  const givenExistingCategories = (given: any) =>
    given(/^existing categories:$/, (table: Array<{ name: string; kind: string }>) => {
      categories = table.map((r) => ({
        id: nextId('cat'),
        name: r.name,
        kind: r.kind as TransactionType,
      }));
    });

  const givenExistingPayees = (given: any) =>
    given(/^existing payees:$/, (table: Array<{ name: string }>) => {
      payees = table.map((r) => ({ id: nextId('pay'), name: r.name }));
    });

  const whenLocallyParse = (when: any) =>
    when(/^I locally parse "(.*)"$/, (text: string) => {
      parsed = localParse(text, { categories, payees, now: NOW });
    });

  const whenLocallyParseAtTime = (when: any) =>
    when(/^I locally parse "(.*)" at time (\d+)$/, (text: string, now: string) => {
      parsed = localParse(text, { categories, payees, now: parseInt(now, 10) });
    });

  const whenLocallyParseAtCurrency = (when: any) =>
    when(/^I locally parse "(.*)" at currency "([A-Z]{3})"$/, (text: string, currency: string) => {
      parsed = localParse(text, { categories, payees, now: NOW, currency });
    });

  test('A currency-symbol amount is parsed to minor units', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('An amount adjacent to a spend verb is parsed to minor units', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A decimal amount is parsed to minor units', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A thousands-separated decimal amount is parsed to minor units', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A "k" suffix amount is parsed to minor units', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('No number in the text means no amount', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be null$/, () => {
      expect(parsed.amount).toBeNull();
    });
  });

  test('An amount of zero is treated as no amount', ({ when, then, and }) => {
    whenLocallyParse(when);
    then(/^the parsed amount should be null$/, () => {
      expect(parsed.amount).toBeNull();
    });
    and(/^the parsed confidence should be (\d+)$/, (val: string) => {
      expect(parsed.confidence).toBe(parseInt(val, 10));
    });
  });

  test('A spend verb with no other indicator defaults to expense', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed type should be "(.*)"$/, (type: string) => {
      expect(parsed.type).toBe(type);
    });
  });

  test('An income verb is recognised', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed type should be "(.*)"$/, (type: string) => {
      expect(parsed.type).toBe(type);
    });
  });

  test('A transfer verb is recognised', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed type should be "(.*)"$/, (type: string) => {
      expect(parsed.type).toBe(type);
    });
  });

  test('With no type keyword at all, the type defaults to expense', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed type should be "(.*)"$/, (type: string) => {
      expect(parsed.type).toBe(type);
    });
  });

  test('An exact existing category name is matched', ({ given, when, then }) => {
    givenExistingCategories(given);
    whenLocallyParse(when);
    then(/^the parsed category should be "(.*)"$/, (name: string) => {
      expect(parsed.category).toBe(name);
    });
  });

  test('An unmatched category word is never invented', ({ given, when, then }) => {
    givenExistingCategories(given);
    whenLocallyParse(when);
    then(/^the parsed category should be null$/, () => {
      expect(parsed.category).toBeNull();
    });
  });

  test('A category that only exists under a different kind never matches', ({
    given,
    when,
    then,
  }) => {
    givenExistingCategories(given);
    whenLocallyParse(when);
    then(/^the parsed category should be null$/, () => {
      expect(parsed.category).toBeNull();
    });
  });

  test('An "at" anchor matches an existing payee', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenLocallyParse(when);
    then(/^the parsed payee should be "(.*)"$/, (name: string) => {
      expect(parsed.payee).toBe(name);
    });
  });

  test('An "at" anchor with no existing match returns the extracted name', ({
    given,
    when,
    then,
  }) => {
    givenExistingPayees(given);
    whenLocallyParse(when);
    then(/^the parsed payee should be "(.*)"$/, (name: string) => {
      expect(parsed.payee).toBe(name);
    });
  });

  test('No anchor phrase means no payee', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed payee should be null$/, () => {
      expect(parsed.payee).toBeNull();
    });
  });

  test('"to" is not a payee anchor (avoids infinitive/direction false positives)', ({
    when,
    then,
  }) => {
    whenLocallyParse(when);
    then(/^the parsed payee should be null$/, () => {
      expect(parsed.payee).toBeNull();
    });
  });

  test('A fuzzy (near-typo) payee match returns the raw text, not the existing name', ({
    given,
    when,
    then,
  }) => {
    givenExistingPayees(given);
    whenLocallyParse(when);
    then(/^the parsed payee should be "(.*)"$/, (name: string) => {
      expect(parsed.payee).toBe(name);
    });
  });

  test('A lowercase anchor still matches an existing payee exactly', ({ given, when, then }) => {
    givenExistingPayees(given);
    whenLocallyParse(when);
    then(/^the parsed payee should be "(.*)"$/, (name: string) => {
      expect(parsed.payee).toBe(name);
    });
  });

  test('A long anchor phrase does not capture the rest of the sentence', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed payee should be "(.*)"$/, (name: string) => {
      expect(parsed.payee).toBe(name);
    });
  });

  test('Defaults — currency, account are null, occurredAt is the injected clock', ({
    when,
    then,
    and,
  }) => {
    whenLocallyParseAtTime(when);
    then(/^the parsed currency should be null$/, () => {
      expect(parsed.currency).toBeNull();
    });
    and(/^the parsed account should be null$/, () => {
      expect(parsed.account).toBeNull();
    });
    and(/^the parsed occurredAt should be (\d+)$/, (ms: string) => {
      expect(parsed.occurredAt).toBe(parseInt(ms, 10));
    });
  });

  test('Confidence is high when an amount is found', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed confidence should be at least (.*)$/, (min: string) => {
      expect(parsed.confidence).toBeGreaterThanOrEqual(parseFloat(min));
    });
  });

  test('Confidence is zero when no amount is found', ({ when, then }) => {
    whenLocallyParse(when);
    then(/^the parsed confidence should be (\d+)$/, (val: string) => {
      expect(parsed.confidence).toBe(parseInt(val, 10));
    });
  });

  // ─── Currency-aware scale (review F1 / M7) ─────────────────────────────
  test('A bare amount at the default (2-decimal) currency scales ×100', ({ when, then }) => {
    whenLocallyParseAtCurrency(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A bare amount at a 0-decimal currency is not scaled at all', ({ when, then }) => {
    whenLocallyParseAtCurrency(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A decimal amount at a 0-decimal currency still rounds to whole units', ({ when, then }) => {
    whenLocallyParseAtCurrency(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });

  test('A bare amount at a 3-decimal currency scales ×1000', ({ when, then }) => {
    whenLocallyParseAtCurrency(when);
    then(/^the parsed amount should be (\d+)$/, (amt: string) => {
      expect(parsed.amount).toBe(parseInt(amt, 10));
    });
  });
});

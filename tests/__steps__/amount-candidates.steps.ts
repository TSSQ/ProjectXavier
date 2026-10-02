import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { extractAmountCandidates, amountCandidateSchema } from '../../src/domain/amountCandidates';

const feature = loadFeature(path.resolve(__dirname, '../__features__/amount-candidates.feature'));

const values = (text: string): string => {
  const found = extractAmountCandidates(text).map((c) => String(c.value));
  return found.length ? found.join(',') : 'none';
};

const SAMPLES = [
  'coffee 4.80', 'paid $1,250 for rent', '€1.234,56 groceries', '+3200 payday', '15 bucks for lunch',
  'spent twenty dollars on gas', '2 coffees 9.60', 'call 555-123-4567 and pay 20', 'remind me at 5pm',
];

defineFeature(feature, (test) => {
  const amountsOf = (then: any) =>
    then(/^the amount candidates of "(.*)" are "(.*)"$/, (text: string, expected: string) => {
      expect(values(text)).toBe(expected);
    });

  for (const title of [
    'Amounts in the usual written forms',
    'Spelled-out amounts are read only with a currency word',
    'Numbers that are not amounts',
    'A non-amount number next to a real amount does not hide it',
    'A count or label before a real amount is dropped, but kept when it is all there is',
    'Several plausible amounts are all returned, in reading order, once each',
    'A number marked as money wins over bare numbers',
  ]) {
    test(title, ({ then }) => amountsOf(then));
  }

  test('A candidate carries its span, its position and whether it was marked as money', ({ then, and }) => {
    const span = (step: any) =>
      step(
        /^"(.*)" yields the candidate span "(.*)" at (\d+) (not marked|marked) as money$/,
        (text: string, span: string, index: string, marked: string) => {
          const [c] = extractAmountCandidates(text);
          expect(c).toMatchObject({ text: span, index: Number(index), anchored: marked === 'marked' });
        }
      );
    span(then);
    span(and);
  });

  test('Every candidate validates against the schema and is positive and finite', ({ then }) => {
    then('every candidate of the sample texts validates and is positive and finite', () => {
      let seen = 0;
      for (const text of SAMPLES) {
        for (const c of extractAmountCandidates(text)) {
          seen += 1;
          expect(amountCandidateSchema.safeParse(c).success).toBe(true);
          expect(c.value).toBeGreaterThan(0);
          expect(Number.isFinite(c.value)).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(0);
    });
  });
});

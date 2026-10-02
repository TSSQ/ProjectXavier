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
    'Fractions of a unit and cents',
    'A currency code after a number belongs to that number',
    'One dot and exactly three digits is ambiguous, so both readings are offered',
    'Names, periods and dates that are made of numbers',
    'A letter prefix may carry a dot, and a bare leading dot is only a fraction',
    'A space-grouped number counts as thousands only when it is anchored',
    'A sign is a weak hint: it never removes another number',
    'A glued c is cents, but a label before it still counts',
    'Dollars and a bare two-digit number, fractions of a cent, years',
    'Quantity times price offers the product as one more reading',
  ]) {
    test(title, ({ then }) => amountsOf(then));
  }

  test('A very long text is read in linear time', ({ then }) => {
    then(/^a (\d+) character text is read in under (\d+) milliseconds$/, (n: string, ms: string) => {
      for (const unit of ['coffee 4 ', '1 ', '12-34-', '5555 ']) {
        const text = unit.repeat(Math.ceil(Number(n) / unit.length)).slice(0, Number(n));
        const started = Date.now();
        extractAmountCandidates(text);
        expect(Date.now() - started).toBeLessThan(Number(ms));
      }
    });
  });

  test('Digits from other scripts are not read, so such a text goes to the model', ({ then }) => {
    amountsOf(then);
  });

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

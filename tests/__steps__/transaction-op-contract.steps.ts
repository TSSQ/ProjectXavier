import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  transactionOpSelectionSchema,
  normalizeTransactionOpSelection,
  buildTransactionOpInstructions,
  buildTransactionOpPrompt,
} from '../../src/domain/transactionOpSelection';

const feature = loadFeature(path.resolve(__dirname, '../__features__/transaction-op-contract.feature'));

/** "NONE" (the Gherkin sentinel) -> JS null; anything else -> itself. */
function expectedOp(cell: string): 'delete' | 'update' | null {
  return cell === 'NONE' ? null : (cell as 'delete' | 'update');
}

defineFeature(feature, (test) => {
  test('The schema has exactly one field, a closed three-value enum', ({ then, and }) => {
    then(/^the transaction-op schema should have exactly one field named "(.*)"$/, (field: string) => {
      const keys = Object.keys(transactionOpSelectionSchema.shape);
      expect(keys).toEqual([field]);
    });
    and(/^the "(.*)" field should be a closed enum of "(.*)", "(.*)", "(.*)"$/, (
      _field: string,
      a: string,
      b: string,
      c: string
    ) => {
      const def = transactionOpSelectionSchema.shape.op._def;
      expect(def.typeName).toBe('ZodEnum');
      expect(def.values).toEqual([a, b, c]);
    });
    and(/^the schema should have no optional, nullable, or free string field$/, () => {
      const shape = transactionOpSelectionSchema.shape;
      for (const key of Object.keys(shape)) {
        const field = shape[key as keyof typeof shape];
        expect(field.isOptional()).toBe(false);
        expect(field.isNullable()).toBe(false);
        expect(field._def.typeName).not.toBe('ZodString');
      }
    });
  });

  test('A well-formed model answer normalizes to the right result', ({ when, then }) => {
    let raw: string;
    when(/^I normalize a raw transaction-op selection with op "(.*)"$/, (op: string) => {
      raw = op;
    });
    then(/^the normalized op should be (.*)$/, (expected: string) => {
      expect(normalizeTransactionOpSelection({ op: raw })).toBe(expectedOp(expected));
    });
  });

  test('A non-string op (a number) is rejected, never coerced', ({ when, then }) => {
    let result: 'delete' | 'update' | null;
    when(/^I normalize a raw transaction-op selection with a numeric op of (\d+)$/, (n: string) => {
      result = normalizeTransactionOpSelection({ op: Number(n) });
    });
    then(/^the normalized op should be (.*)$/, (expected: string) => {
      expect(result).toBe(expectedOp(expected));
    });
  });

  test('An empty object is rejected, never throws', ({ when, then }) => {
    let result: 'delete' | 'update' | null;
    when(/^I normalize an empty raw transaction-op selection$/, () => {
      expect(() => normalizeTransactionOpSelection({})).not.toThrow();
      result = normalizeTransactionOpSelection({});
    });
    then(/^the normalized op should be (.*)$/, (expected: string) => {
      expect(result).toBe(expectedOp(expected));
    });
  });

  test('A null raw payload never throws', ({ then }) => {
    then(/^normalizing a null transaction-op selection should not throw and should be (.*)$/, (
      expected: string
    ) => {
      expect(() =>
        normalizeTransactionOpSelection(null as unknown as Record<string, unknown>)
      ).not.toThrow();
      expect(normalizeTransactionOpSelection(null as unknown as Record<string, unknown>)).toBe(
        expectedOp(expected)
      );
    });
  });

  test('System instructions carry the load-bearing "user picks the row" line', ({ then }) => {
    then(/^the transaction-op instructions should mention that the user chooses the transaction themselves$/, () => {
      const instructions = buildTransactionOpInstructions();
      expect(instructions).toContain('the user will');
      expect(instructions).toContain('choose it themselves');
    });
  });

  test('The user-turn prompt is the raw message and nothing else — no grounding lists', ({ then }) => {
    then(/^the transaction-op prompt for "(.*)" should be exactly "(.*)"$/, (
      text: string,
      expected: string
    ) => {
      expect(buildTransactionOpPrompt(text)).toBe(expected);
    });
  });
});

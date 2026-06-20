import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Transaction } from '../../src/domain/types';
import { insertTransaction } from '../../src/db/sql';
import {
  aiParsedExpenseSchema,
  AiParsedExpense,
  missingFields,
} from '../../src/lib/validation';
import { makeTransaction } from '../support/world';
import { FakeDb } from '../support/fakeDb';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/input-safety.feature')
);

defineFeature(feature, (test) => {
  test('A note containing SQL is stored verbatim and safely', ({
    given,
    when,
    then,
    and,
  }) => {
    let tx: Transaction;
    let note: string;
    const db = new FakeDb();

    given(/^a transaction whose note is "(.*)"$/, (n) => {
      note = n;
      tx = makeTransaction({
        type: 'expense',
        amount: 1000,
        accountId: 'acc-1',
        note: n,
      });
    });
    when(/^I save it through the parameterised repository$/, async () => {
      await insertTransaction(db, tx);
    });
    then(/^the stored note should equal "(.*)"$/, (expected) => {
      expect(db.last.params).toContain(expected);
      expect(db.last.params).toContain(note);
    });
    and(
      /^the SQL statement should use bound parameters, not the note text$/,
      () => {
        expect(db.last.sql).not.toContain(note);
        expect(db.last.sql).toContain('?');
      }
    );
  });

  test('AI output missing the amount is rejected', ({ given, then }) => {
    let parsed: AiParsedExpense;
    given(/^an AI returns a parsed expense with no amount$/, () => {
      parsed = aiParsedExpenseSchema.parse({
        amount: null,
        currency: 'USD',
        type: 'expense',
        category: 'Food',
        payee: 'Cafe',
        note: 'Latte',
        occurredAt: Date.UTC(2026, 0, 1),
        confidence: 0.4,
      });
    });
    then(/^validation should flag "(.*)" as a missing field$/, (field) => {
      expect(missingFields(parsed)).toContain(field);
    });
  });

  test('Malformed AI output fails schema validation', ({ given, then }) => {
    let raw: unknown;
    given(/^an AI returns a parsed expense with a negative amount$/, () => {
      raw = {
        amount: -500,
        currency: 'USD',
        type: 'expense',
        category: 'Food',
        payee: 'Cafe',
        note: 'Latte',
        occurredAt: Date.UTC(2026, 0, 1),
        confidence: 0.9,
      };
    });
    then(/^schema validation should reject it$/, () => {
      expect(aiParsedExpenseSchema.safeParse(raw).success).toBe(false);
    });
  });
});

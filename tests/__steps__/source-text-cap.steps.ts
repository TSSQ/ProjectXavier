import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { buildTransaction, TransactionDraft } from '../../src/domain/assistant';
import { transactionSchema, SOURCE_TEXT_MAX_CHARS } from '../../src/lib/validation';
import { Transaction } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/source-text-cap.feature'));

const NOW = Date.UTC(2026, 0, 1);

function makeDraft(sourceText: TransactionDraft['sourceText']): TransactionDraft {
  return {
    accountId: 'acc-1',
    type: 'expense',
    amount: 1250,
    currency: 'USD',
    categoryName: null,
    payeeName: null,
    note: null,
    occurredAt: NOW,
    source: 'ai',
    sourceText,
    defaulted: { account: false, payee: true, category: true, date: false },
  };
}

defineFeature(feature, (test) => {
  test('A 5000-character sourceText is truncated and still validates', ({
    given,
    when,
    then,
    and,
  }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft with a 5000-character sourceText$/, () => {
      draft = makeDraft('x'.repeat(5000));
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-1',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should be exactly SOURCE_TEXT_MAX_CHARS long$/, () => {
      expect(tx.sourceText).toHaveLength(SOURCE_TEXT_MAX_CHARS);
    });

    and(/^the transaction should pass transactionSchema validation$/, () => {
      expect(() => transactionSchema.parse(tx)).not.toThrow();
    });
  });

  test('A short sourceText is left unchanged', ({ given, when, then }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft with the sourceText "(.*)"$/, (text: string) => {
      draft = makeDraft(text);
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-2',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should equal "(.*)"$/, (text: string) => {
      expect(tx.sourceText).toBe(text);
    });
  });

  test('A null sourceText stays null', ({ given, when, then }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft with no sourceText$/, () => {
      draft = makeDraft(null);
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-3',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should be null$/, () => {
      expect(tx.sourceText).toBeNull();
    });
  });

  test('An undefined sourceText stays null', ({ given, when, then }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft whose sourceText is undefined$/, () => {
      draft = makeDraft(undefined);
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-4',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should be null$/, () => {
      expect(tx.sourceText).toBeNull();
    });
  });

  test('A sourceText of exactly the cap length is unchanged', ({ given, when, then, and }) => {
    let draft: TransactionDraft;
    let tx: Transaction;
    let original: string;

    given(/^a confirmed draft with a sourceText exactly SOURCE_TEXT_MAX_CHARS long$/, () => {
      original = 'y'.repeat(SOURCE_TEXT_MAX_CHARS);
      draft = makeDraft(original);
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-5',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should be exactly SOURCE_TEXT_MAX_CHARS long$/, () => {
      expect(tx.sourceText).toHaveLength(SOURCE_TEXT_MAX_CHARS);
      expect(tx.sourceText).toBe(original);
    });

    and(/^the transaction should pass transactionSchema validation$/, () => {
      expect(() => transactionSchema.parse(tx)).not.toThrow();
    });
  });

  test('Truncation is surrogate-safe when an astral char straddles the cut', ({
    given,
    when,
    then,
    and,
  }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft whose sourceText has an emoji straddling the cut point$/, () => {
      // 'a' * 1999 + '😀' (a surrogate pair) puts the emoji's high surrogate
      // at index 1999 and its low surrogate at index 2000 — exactly the cut.
      draft = makeDraft('a'.repeat(SOURCE_TEXT_MAX_CHARS - 1) + '\u{1F600}');
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-6',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should contain no unpaired surrogate$/, () => {
      const result = tx.sourceText!;
      // A string with an unpaired surrogate does not round-trip through utf8
      // Buffer encode/decode (Node replaces it with U+FFFD on the way back).
      expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
    });

    and(/^the transaction sourceText length should be at most SOURCE_TEXT_MAX_CHARS$/, () => {
      expect(tx.sourceText!.length).toBeLessThanOrEqual(SOURCE_TEXT_MAX_CHARS);
    });

    and(/^the transaction should pass transactionSchema validation$/, () => {
      expect(() => transactionSchema.parse(tx)).not.toThrow();
    });
  });

  test('An empty-string sourceText is preserved, not turned into null', ({
    given,
    when,
    then,
  }) => {
    let draft: TransactionDraft;
    let tx: Transaction;

    given(/^a confirmed draft with the sourceText ""$/, () => {
      draft = makeDraft('');
    });

    when(/^the draft is built into a transaction$/, () => {
      tx = buildTransaction(draft, {
        id: 'tx-7',
        createdAt: NOW,
        categoryId: null,
        payeeId: null,
      });
    });

    then(/^the transaction sourceText should equal ""$/, () => {
      expect(tx.sourceText).toBe('');
    });
  });
});

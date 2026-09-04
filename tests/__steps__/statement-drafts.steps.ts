import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { reconstructLayout, StatementLayout } from '../../src/domain/statementLayout';
import {
  rowsToDrafts,
  resolveStatementDate,
  applyReceiptTotal,
  findStatementPayeeMatch,
  MAX_STATEMENT_ROWS,
  StatementDraftContext,
} from '../../src/domain/statementDrafts';
import { PayeeMatch } from '../../src/domain/payees';
import { buildTransaction, TransactionDraft } from '../../src/domain/assistant';
import { transactionSchema } from '../../src/lib/validation';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';
import { OcrObservation } from '../../src/domain/ocrObservation';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'statement-drafts.feature'));

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'statement');
const REPO_ROOT = path.join(__dirname, '..', '..');

function loadFixtureObservations(name: string): OcrObservation[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.observations.json`), 'utf8');
  return JSON.parse(raw).observations;
}

/** "2026-09-02T12:00" → epoch ms at that LOCAL date/time (never UTC — the
 *  jest config only defaults TZ to UTC when unset, so "local" here means
 *  whatever this run's TZ is, exactly like the app's own Date usage). */
function parseLocal(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Unparseable local timestamp: ${s}`);
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0).getTime();
}

/** "2026-08-25" → local calendar day label, for comparing against a draft's
 *  occurredAt by calendar day rather than exact ms. */
function localDayLabel(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

defineFeature(feature, (test) => {
  let layout: StatementLayout;
  let account: Account;
  let otherAccounts: Account[] = [];
  let payees: Payee[] = [];
  let categories: Category[] = [];
  let existing: Transaction[] = [];
  let now: number;
  let drafts: TransactionDraft[];
  let dropped: number;
  let plainDraft: TransactionDraft;
  let resolvedDate: ReturnType<typeof resolveStatementDate>;

  const reset = () => {
    otherAccounts = [];
    payees = [];
    categories = [];
    existing = [];
  };

  const givenLayout = (given: any) =>
    given(/^the "(.*)" statement fixture reconstructed as a layout$/, (name: string) => {
      reset();
      layout = reconstructLayout(loadFixtureObservations(name));
    });

  // Reviewer M1/B3 scenarios build observations inline — same idiom as
  // statement-layout.steps.ts's own givenSyntheticObservations.
  const givenSyntheticLayout = (given: any) =>
    given(
      /^a synthetic layout with these observations:$/,
      (table: Array<{ text: string; x: string; y: string; w: string; h: string }>) => {
        reset();
        const observations: OcrObservation[] = table.map((r) => ({
          text: r.text,
          x: Number(r.x),
          y: Number(r.y),
          w: Number(r.w),
          h: Number(r.h),
        }));
        layout = reconstructLayout(observations);
      }
    );

  const givenAccount = (and: any) =>
    and(/^the account "(.*)" in (.*)$/, (name: string, currency: string) => {
      account = { id: 'acc-main', name, currency, openingBalance: 0 };
    });

  // Matches both "another account "PayLah" in SGD" and "another account
  // "Rainy Day" (cash) in SGD" — the optional "(subtype)" group.
  const givenOtherAccount = (and: any) =>
    and(
      /^another account "(.*?)"(?: \((.*)\))? in (.*)$/,
      (name: string, subtype: string | undefined, currency: string) => {
        otherAccounts.push({
          id: `acc-other-${otherAccounts.length}`,
          name,
          subtype,
          currency,
          openingBalance: 0,
        });
      }
    );

  const givenNow = (and: any) =>
    and(/^now is (\S+) local$/, (raw: string) => {
      const literal = raw.replace(/^"|"$/g, '');
      now = parseLocal(literal);
    });

  const whenBuildDrafts = (when: any) =>
    when('I build drafts from the layout', () => {
      const ctx: StatementDraftContext = {
        account,
        accounts: [account, ...otherAccounts],
        payees,
        categories,
        existing,
        now,
      };
      const result = rowsToDrafts(layout, ctx);
      drafts = result.drafts;
      dropped = result.dropped;
    });

  test('bank1 — six expense drafts with cleaned payees and the printed date', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    and(/^the payee "(.*)" with default category "(.*)"$/, (name: string, categoryName: string) => {
      categories.push({ id: 'cat-1', name: categoryName, kind: 'expense' });
      payees.push({ id: 'payee-1', name, defaultCategoryId: 'cat-1' });
    });
    givenNow(and);
    whenBuildDrafts(when);
    then('there should be no dropped rows', () => expect(dropped).toBe(0));
    and(/^there should be (\d+) drafts$/, (n: string) => expect(drafts).toHaveLength(Number(n)));
    and('every draft should be an expense', () => {
      for (const d of drafts) expect(d.type).toBe('expense');
    });
    and(/^the draft amounts should be (.*)$/, (list: string) => {
      expect(drafts.map((d) => d.amount)).toEqual(list.split(',').map((s) => Number(s.trim())));
    });
    and(/^every draft should occur on (\d{4}-\d{2}-\d{2})$/, (day: string) => {
      for (const d of drafts) expect(localDayLabel(d.occurredAt)).toBe(day);
    });
    and("every draft's date should not be defaulted", () => {
      for (const d of drafts) expect(d.defaulted.date).toBe(false);
    });
    and(/^the draft payee names should be (.*)$/, (list: string) => {
      const expected = list.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      expect(drafts.map((d) => d.payeeName)).toEqual(expected);
    });
    and(/^no draft payee name should contain "(.*)" or "(.*)" or "(.*)" or "(.*)" or "(.*)"$/, (...tokens: string[]) => {
      const needles = tokens.slice(0, 5);
      for (const d of drafts) {
        for (const needle of needles) {
          expect(d.payeeName ?? '').not.toContain(needle);
        }
      }
    });
    and(/^draft (\d+)'s payee name should suggest the payee "(.*)"$/, (n: string, payeeName: string) => {
      const d = drafts[Number(n) - 1]!;
      const match = findStatementPayeeMatch(d.payeeName ?? '', payees);
      expect(match.suggestion?.name).toBe(payeeName);
    });
    and(/^draft (\d+)'s category should be null and defaulted$/, (n: string) => {
      const d = drafts[Number(n) - 1]!;
      expect(d.categoryName).toBeNull();
      expect(d.defaulted.category).toBe(true);
    });
  });

  test('OCBC — four drafts, every one carrying a transfer hint', ({ given, and, when, then }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    whenBuildDrafts(when);
    then(/^there should be (\d+) drafts$/, (n: string) => expect(drafts).toHaveLength(Number(n)));
    and(/^the draft types should be (.*)$/, (list: string) => {
      const expected = list.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      expect(drafts.map((d) => d.type)).toEqual(expected);
    });
    and(/^the draft amounts should be (.*)$/, (list: string) => {
      expect(drafts.map((d) => d.amount)).toEqual(list.split(',').map((s) => Number(s.trim())));
    });
    and(/^drafts 1 to 3 should occur on (\d{4}-\d{2}-\d{2})$/, (day: string) => {
      for (const d of drafts.slice(0, 3)) expect(localDayLabel(d.occurredAt)).toBe(day);
    });
    and(/^draft 4 should occur on (\d{4}-\d{2}-\d{2})$/, (day: string) => {
      expect(localDayLabel(drafts[3]!.occurredAt)).toBe(day);
    });
    and('every draft should carry a transfer hint', () => {
      for (const d of drafts) expect(d.transferHint).toBe(true);
    });
    and(
      /^no draft payee name should contain a reference number or "(.*)" or "(.*)" or "(.*)" or "(.*)"$/,
      (...noise: string[]) => {
        const needles = noise.slice(0, 4);
        for (const d of drafts) {
          expect(d.payeeName ?? '').not.toMatch(/\d{6,}/);
          for (const needle of needles) expect(d.payeeName ?? '').not.toContain(needle);
        }
      }
    );
  });

  test('OCBC — a matching PayLah account resolves the first two rows as transfers', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    givenOtherAccount(and);
    givenNow(and);
    whenBuildDrafts(when);
    const transferStep = (n: string, name: string) => {
      const d = drafts[Number(n) - 1]!;
      expect(d.type).toBe('transfer');
      expect(d.transferAccountName).toBe(name);
    };
    then(/^draft (\d+) should be a transfer to "(.*)"$/, transferStep);
    and(/^draft (\d+) should be a transfer to "(.*)"$/, transferStep);
    const notTransferStep = (n: string) => {
      const d = drafts[Number(n) - 1]!;
      expect(d.type).not.toBe('transfer');
    };
    and(/^draft (\d+) should not be a transfer$/, notTransferStep);
    and(/^draft (\d+) should not be a transfer$/, notTransferStep);
    const stillHintStep = (n: string) => {
      const d = drafts[Number(n) - 1]!;
      expect(d.transferHint).toBe(true);
    };
    and(/^draft (\d+) should still carry a transfer hint$/, stillHintStep);
    and(/^draft (\d+) should still carry a transfer hint$/, stillHintStep);
  });

  test(
    'A subtype-cue-only account match does not silently become a transfer (reviewer M1)',
    ({ given, and, when, then }) => {
      givenSyntheticLayout(given);
      givenAccount(and);
      givenOtherAccount(and);
      givenNow(and);
      whenBuildDrafts(when);
      then(/^there should be (\d+) drafts$/, (n: string) => expect(drafts).toHaveLength(Number(n)));
      and('every draft should be an expense', () => {
        for (const d of drafts) expect(d.type).toBe('expense');
      });
      and('every draft should carry a transfer hint', () => {
        for (const d of drafts) expect(d.transferHint).toBe(true);
      });
      and(/^the draft payee names should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
        expect(drafts.map((d) => d.payeeName)).toEqual(expected);
      });
    }
  );

  test(
    "A row's own foreign currency flags the draft, never converts it (reviewer B3)",
    ({ given, and, when, then }) => {
      givenSyntheticLayout(given);
      givenAccount(and);
      givenNow(and);
      whenBuildDrafts(when);
      then(/^draft (\d+)'s mismatchedCurrency should be (.*)$/, (n: string, raw: string) => {
        const d = drafts[Number(n) - 1]!;
        if (raw === 'undefined') {
          expect(d.mismatchedCurrency).toBeUndefined();
        } else {
          expect(d.mismatchedCurrency).toBe(raw.replace(/^"|"$/g, ''));
        }
      });
    }
  );

  test('OCBC drafts against an SGD account never flag mismatchedCurrency', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    whenBuildDrafts(when);
    then('no draft should have a mismatchedCurrency', () => {
      for (const d of drafts) expect(d.mismatchedCurrency).toBeUndefined();
    });
  });

  test("Resolving a row's date text", ({ given, when, then, and }) => {
    given(/^now is "(.*)" local$/, (raw: string) => {
      now = parseLocal(raw);
    });
    when(/^I resolve the statement date "(.*)"$/, (raw: string) => {
      const dateText = raw === 'null' ? null : raw;
      resolvedDate = resolveStatementDate(dateText, now);
    });
    then(/^the resolved date should be "(.*)"$/, (day: string) => {
      expect(localDayLabel(resolvedDate.occurredAt)).toBe(day);
    });
    and(/^the date should (.*) be defaulted$/, (mod: string) => {
      expect(resolvedDate.defaultedDate).toBe(mod === 'should');
    });
  });

  test("An exact payee match adopts the payee's name and default category", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    and(/^the payee "(.*)" with default category "(.*)"$/, (name: string, categoryName: string) => {
      categories.push({ id: 'cat-1', name: categoryName, kind: 'expense' });
      payees.push({ id: 'payee-1', name, defaultCategoryId: 'cat-1' });
    });
    givenNow(and);
    whenBuildDrafts(when);
    then(
      /^draft (\d+)'s payee should be "(.*)" with category "(.*)", not defaulted$/,
      (n: string, payeeName: string, categoryName: string) => {
        const d = drafts[Number(n) - 1]!;
        expect(d.payeeName).toBe(payeeName);
        expect(d.categoryName).toBe(categoryName);
        expect(d.defaulted.category).toBe(false);
      }
    );
  });

  test('No payee match leaves the category unset — never guessed from a keyword', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    whenBuildDrafts(when);
    then("every draft's category should be null and defaulted", () => {
      for (const d of drafts) {
        expect(d.categoryName).toBeNull();
        expect(d.defaulted.category).toBe(true);
      }
    });
  });

  test(
    'findStatementPayeeMatch — a statement-only whole-word-prefix net on top of findPayeeMatch',
    ({ given, when, then }) => {
      let localPayees: Payee[];
      let match: PayeeMatch;
      given(/^the payees "(.*)"$/, (list: string) => {
        localPayees = list.split(',').map((s, i) => ({ id: `p${i}`, name: s.trim() }));
      });
      when(/^I find a statement payee match for "(.*)"$/, (name: string) => {
        match = findStatementPayeeMatch(name, localPayees);
      });
      then(/^the match should be "(.*)"$/, (expected: string) => {
        if (expected === 'no match') {
          expect(match.exact).toBeUndefined();
          expect(match.suggestion).toBeUndefined();
          return;
        }
        const [kind, name] = expected.split(':').map((s) => s.trim());
        if (kind === 'exact') {
          expect(match.exact?.name).toBe(name);
          expect(match.suggestion).toBeUndefined();
        } else if (kind === 'suggestion') {
          expect(match.suggestion?.name).toBe(name);
          expect(match.exact).toBeUndefined();
        } else {
          throw new Error(`Unrecognised expected match kind: "${kind}"`);
        }
      });
    }
  );

  const givenExistingTx = (and: any) =>
    and(
      /^an existing SGD ([\d.]+) (expense|income) on (\d{4}-\d{2}-\d{2}) in that account$/,
      (amountMajor: string, type: string, day: string) => {
        const [y, mo, d] = day.split('-').map(Number);
        existing.push({
          id: 'existing-1',
          accountId: 'acc-main',
          type: type as 'expense' | 'income',
          amount: Math.round(Number(amountMajor) * 100),
          currency: 'SGD',
          occurredAt: new Date(y!, mo! - 1, d!, 12, 0, 0).getTime(),
          createdAt: 0,
          source: 'manual',
          pending: false,
        });
      }
    );

  test('A same-amount, same-day, same-account transaction flags a likely duplicate', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    givenExistingTx(and);
    whenBuildDrafts(when);
    then('draft 1 should be flagged as a likely duplicate', () => {
      expect(drafts[0]!.duplicateOf).toBeTruthy();
      expect(drafts[0]!.duplicateOf!.id).toBe('existing-1');
    });
    and(/^there should still be (\d+) drafts$/, (n: string) => expect(drafts).toHaveLength(Number(n)));
  });

  test('A different day does not flag a duplicate', ({ given, and, when, then }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    givenExistingTx(and);
    whenBuildDrafts(when);
    then('draft 1 should not be flagged as a duplicate', () => {
      expect(drafts[0]!.duplicateOf).toBeUndefined();
    });
  });

  test('The same amount as income does not flag a duplicate', ({ given, and, when, then }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    givenExistingTx(and);
    whenBuildDrafts(when);
    then('draft 1 should not be flagged as a duplicate', () => {
      expect(drafts[0]!.duplicateOf).toBeUndefined();
    });
  });

  test('Every drafted transaction passes the persisted transaction schema', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    givenAccount(and);
    givenNow(and);
    whenBuildDrafts(when);
    then('every draft should pass the persisted transaction schema', () => {
      expect(drafts.length).toBeGreaterThan(0);
      for (const draft of drafts) {
        const tx = buildTransaction(draft, {
          id: 'tx-new',
          createdAt: Date.now(),
          categoryId: null,
          payeeId: null,
        });
        expect(() => transactionSchema.parse(tx)).not.toThrow();
      }
    });
  });

  test('applyReceiptTotal replaces the amount only when a total was found', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLayout(given);
    and(/^a plain expense draft for (\d+) minor units in (.*)$/, (amount: string, currency: string) => {
      plainDraft = {
        accountId: 'acc-main',
        type: 'expense',
        amount: Number(amount),
        currency,
        categoryName: null,
        payeeName: 'Some Shop',
        note: null,
        occurredAt: Date.now(),
        source: 'ai',
        defaulted: { account: false, payee: false, category: true, date: false },
      };
    });
    let applied: TransactionDraft;
    when('I apply the receipt total to that draft', () => {
      applied = applyReceiptTotal(plainDraft, layout);
    });
    then(/^the draft amount should be (\d+)$/, (amount: string) => {
      expect(applied.amount).toBe(Number(amount));
    });
    and('the draft should be flagged amount-from-total', () => {
      expect(applied.amountFromTotal).toBe(true);
    });
  });

  test('applyReceiptTotal leaves the draft unchanged without a total', ({ given, and, when, then }) => {
    given('a layout with no receipt total', () => {
      layout = { kind: 'unknown', rows: [], headerText: '', receiptTotal: null, unreadRows: 0, text: '' };
    });
    and(/^a plain expense draft for (\d+) minor units in (.*)$/, (amount: string, currency: string) => {
      plainDraft = {
        accountId: 'acc-main',
        type: 'expense',
        amount: Number(amount),
        currency,
        categoryName: null,
        payeeName: 'Some Shop',
        note: null,
        occurredAt: Date.now(),
        source: 'ai',
        defaulted: { account: false, payee: false, category: true, date: false },
      };
    });
    let applied: TransactionDraft;
    when('I apply the receipt total to that draft', () => {
      applied = applyReceiptTotal(plainDraft, layout);
    });
    then(/^the draft amount should be (\d+)$/, (amount: string) => {
      expect(applied.amount).toBe(Number(amount));
    });
    and('the draft should not be flagged amount-from-total', () => {
      expect(applied.amountFromTotal).toBeUndefined();
    });
  });

  test(
    'applyReceiptTotal leaves the draft unchanged when the only candidate is too far to pair (total-pairing-spec.md criterion 5)',
    ({ given, and, when, then }) => {
      givenSyntheticLayout(given);
      and(/^a plain expense draft for (\d+) minor units in (.*)$/, (amount: string, currency: string) => {
        plainDraft = {
          accountId: 'acc-main',
          type: 'expense',
          amount: Number(amount),
          currency,
          categoryName: null,
          payeeName: 'Some Shop',
          note: null,
          occurredAt: Date.now(),
          source: 'ai',
          defaulted: { account: false, payee: false, category: true, date: false },
        };
      });
      let applied: TransactionDraft;
      when('I apply the receipt total to that draft', () => {
        applied = applyReceiptTotal(plainDraft, layout);
      });
      then(/^the draft amount should be (\d+)$/, (amount: string) => {
        expect(applied.amount).toBe(Number(amount));
      });
      and('the draft should not be flagged amount-from-total', () => {
        expect(applied.amountFromTotal).toBeUndefined();
      });
    }
  );

  // Matches the model-calling identifiers themselves (a call to
  // generateObject/deviceParse/openaiParse/anthropicParse, or an import of
  // features/ai/deviceParse) — not just any file whose NAME happens to share
  // a prefix. statementDrafts.ts legitimately imports the regex-only
  // `resolveAbsoluteDate` from deviceParsePrompt.ts (docs/design/
  // statement-scan-spec.md criterion 17); that import must NOT trip this.
  const NO_MODEL_CALL_RE =
    /\bgenerateObject\b|\bdeviceParse\s*\(|features\/ai\/deviceParse\b|\bopenaiParse\b|\banthropicParse\b/;

  test('No model call anywhere in the statement domain', ({ then }) => {
    then(
      'neither statementLayout.ts nor statementDrafts.ts should call generateObject, deviceParse(), openaiParse or anthropicParse, nor import features/ai/deviceParse',
      () => {
        const files = ['src/domain/statementLayout.ts', 'src/domain/statementDrafts.ts'];
        for (const file of files) {
          const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
          expect(source).not.toMatch(NO_MODEL_CALL_RE);
        }
      }
    );
  });

  test(
    'The statement row cap is 60 (QA MINOR 7 — the screen checks this on the drafts array, not layout.rows)',
    ({ then }) => {
      then('MAX_STATEMENT_ROWS should be 60', () => {
        expect(MAX_STATEMENT_ROWS).toBe(60);
      });
    }
  );
});

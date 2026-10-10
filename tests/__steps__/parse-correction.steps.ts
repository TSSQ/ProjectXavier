import path from 'path';
import os from 'os';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Category, TransactionType } from '../../src/domain/types';
import {
  buildCorrectionCase,
  CorrectionCase,
  DEV_ADDITION_ID_PREFIX,
  parseCorrectionsText,
  serializeCorrectionLine,
} from '../../src/domain/parseCorrection';
import { makeAccount, nextId } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/parse-correction.feature'));

const REPO_ROOT = path.resolve(__dirname, '../..');
const FOLD_SCRIPT = path.join(REPO_ROOT, 'evals', 'corrections', 'fold.mjs');
const SPLIT_SCRIPT = path.join(REPO_ROOT, 'evals', 'split.mjs');

/** Run the real fold script (`--validate` never writes the dataset). */
function runFold(file: string): { status: number; out: string } {
  try {
    const out = execFileSync('node', [FOLD_SCRIPT, '--validate', file], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const VALID_LINE = (id: string) =>
  JSON.stringify({
    id,
    axis: 'user-correction',
    text: 'coffee 4.80',
    context: { categories: [{ name: 'Dining', kind: 'expense' }], payees: [], accounts: ['Wallet'], nowISO: '2026-10-10T12:00:00+08:00' },
    expected: { amountMinor: 480, sign: 'expense', dateISO: '2026-10-10', category: null, payee: null },
  });

defineFeature(feature, (test) => {
  let categories: Category[];
  let payeeNames: string[];
  let accounts: Account[];
  let now: number;
  let built: CorrectionCase | undefined;
  let thrown: unknown;
  let file: string;
  let fold: { status: number; out: string };
  let parsed: { cases: CorrectionCase[]; invalid: number };

  const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'xavier-corrections-'));

  const parseList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const background = (given: any, and: any) => {
    given(
      /^the parse saw categories "(.*)", payees "(.*)" and accounts "(.*)"$/,
      (cats: string, pays: string, accts: string) => {
        categories = parseList(cats).map((entry) => {
          const [name, kind] = entry.split(':') as [string, TransactionType];
          return { id: nextId('cat'), name, kind };
        });
        payeeNames = parseList(pays);
        accounts = parseList(accts).map((name) => makeAccount({ name, currency: 'SGD' }));
        built = undefined;
        thrown = undefined;
      }
    );
    and(/^the parse ran at local time (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/, (y: string, m: string, d: string, h: string, mi: string) => {
      now = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi)).getTime();
    });
  };

  const whenReports = (when: any) =>
    when(
      /^the user reports "(.*)" as wrong and saves it as an? (expense|income|transfer) of (\d+) on (\d{4})-(\d{2})-(\d{2}) with category "(.*)" and payee "(.*)" from engine "(.*)"$/,
      (
        text: string,
        type: TransactionType,
        amount: string,
        y: string,
        m: string,
        d: string,
        category: string,
        payee: string,
        engine: string
      ) => {
        thrown = undefined;
        try {
          built = buildCorrectionCase({
            text,
            categories,
            payeeNames,
            accounts,
            now,
            corrected: {
              amountMinor: Number(amount),
              type,
              occurredAt: new Date(Number(y), Number(m) - 1, Number(d), 9, 30).getTime(),
              categoryName: category || null,
              payeeName: payee || null,
            },
            engine,
            nonce: 'abc123',
          });
        } catch (e) {
          thrown = e;
        }
      }
    );

  const thenExpected = (then: any) =>
    then(
      /^the case's expected should be amount (\d+), sign "(.*)", date "(.*)", category (?:"(.*)"|null) and payee (?:"(.*)"|null)$/,
      (amount: string, sign: string, date: string, category?: string, payee?: string) => {
        expect(built!.expected).toEqual({
          amountMinor: Number(amount),
          sign,
          dateISO: date,
          category: category ?? null,
          payee: payee ?? null,
        });
      }
    );

  test("A corrected expense becomes a dataset case with the user's fields as expected", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    whenReports(when);
    then(/^the case should carry the text "(.*)"$/, (text: string) => {
      expect(built!.text).toBe(text);
    });
    thenExpected(and);
    and(
      /^the case's context should list categories "(.*)", payees "(.*)" and accounts "(.*)"$/,
      (cats: string, pays: string, accts: string) => {
        expect(built!.context.categories).toEqual(
          parseList(cats).map((e) => {
            const [name, kind] = e.split(':');
            return { name, kind };
          })
        );
        expect(built!.context.payees).toEqual(parseList(pays));
        expect(built!.context.accounts).toEqual(parseList(accts));
      }
    );
    and(/^the case's context nowISO should start with "(.*)"$/, (prefix: string) => {
      expect(built!.context.nowISO.startsWith(prefix)).toBe(true);
      // …and carries the device's own UTC offset, the dataset's convention.
      expect(built!.context.nowISO).toMatch(/[+-]\d{2}:\d{2}$/);
    });
    and(/^the case's axis should be "(.*)" and its engine "(.*)"$/, (axis: string, engine: string) => {
      expect(built!.axis).toBe(axis);
      expect(built!.engine).toBe(engine);
    });
    and(/^the case should carry no split$/, () => {
      expect('split' in built!).toBe(false);
    });
  });

  test('An archived account is not part of the grounding', ({ given, and, when, then }) => {
    background(given, and);
    given(/^the account "(.*)" is archived$/, (name: string) => {
      accounts.find((a) => a.name === name)!.archived = true;
    });
    whenReports(when);
    then(/^the case's context should list accounts "(.*)"$/, (accts: string) => {
      expect(built!.context.accounts).toEqual(parseList(accts));
    });
  });

  test('The id is a dev-split addition so split.mjs can never hold it out', ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    then(/^the case id should start with "(.*)"$/, (prefix: string) => {
      expect(built!.id.startsWith(prefix)).toBe(true);
    });
    and(/^the dev-addition prefix should be the one evals\/split\.mjs uses$/, () => {
      const source = readFileSync(SPLIT_SCRIPT, 'utf8');
      const match = /export const DEV_ADDITION_ID_PREFIX = '([^']+)';/.exec(source);
      expect(match?.[1]).toBe(DEV_ADDITION_ID_PREFIX);
      expect(built!.id.startsWith(DEV_ADDITION_ID_PREFIX)).toBe(true);
    });
  });

  test('A corrected transfer carries no category or payee', ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    thenExpected(then);
  });

  test('An empty category or payee is recorded as null, not an empty string', ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    thenExpected(then);
  });

  test('A correction with no amount is refused before anything is written', ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    then(/^building the case should throw$/, () => {
      expect(thrown).toBeDefined();
      expect(built).toBeUndefined();
    });
  });

  test('A correction with no text is refused before anything is written', ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    then(/^building the case should throw$/, () => {
      expect(thrown).toBeDefined();
      expect(built).toBeUndefined();
    });
  });

  test("A built case is valid against the harness's own dataset schema", ({ given, and, when, then }) => {
    background(given, and);
    whenReports(when);
    and(
      /^the case is written to a corrections file and run through evals\/corrections\/fold\.mjs --validate$/,
      () => {
        file = path.join(tmpDir(), 'parse-corrections.jsonl');
        writeFileSync(file, `${serializeCorrectionLine(built!)}\n`, 'utf8');
        fold = runFold(file);
      }
    );
    then(/^the fold script should accept it as 1 valid, new correction$/, () => {
      expect(fold.out).toContain('1 valid correction(s); 1 new');
      expect(fold.status).toBe(0);
    });
  });

  test('The fold script refuses a case that would not land in the dev split', ({ given, and, when, then }) => {
    background(given, and);
    given(/^a corrections file holding a case whose id is "(.*)"$/, (id: string) => {
      file = path.join(tmpDir(), 'parse-corrections.jsonl');
      writeFileSync(file, `${VALID_LINE(id)}\n`, 'utf8');
    });
    when(/^it is run through evals\/corrections\/fold\.mjs --validate$/, () => {
      fold = runFold(file);
    });
    then(/^the fold script should refuse it, naming the dev prefix$/, () => {
      expect(fold.status).toBe(1);
      expect(fold.out).toContain(`id must start with "${DEV_ADDITION_ID_PREFIX}"`);
    });
  });

  test('Reading the file back tolerates a cut-short last line', ({ given, and, when, then }) => {
    let text: string;
    background(given, and);
    given(/^a corrections file holding two valid cases and a half-written third line$/, () => {
      text = `${VALID_LINE('dv-uc-20261010-000001')}\n${VALID_LINE('dv-uc-20261010-000002')}\n{"id":"dv-uc-2026`;
    });
    when(/^the file is parsed$/, () => {
      parsed = parseCorrectionsText(text);
    });
    then(/^(\d+) cases should be read and (\d+) line counted as invalid$/, (n: string, bad: string) => {
      expect(parsed.cases).toHaveLength(Number(n));
      expect(parsed.invalid).toBe(Number(bad));
    });
  });
});

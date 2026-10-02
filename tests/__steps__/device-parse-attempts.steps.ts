import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runDeviceParseAttempts, DeviceParseAttemptsResult } from '../../src/domain/deviceParseAttempts';

const feature = loadFeature(path.resolve(__dirname, '../__features__/device-parse-attempts.feature'));

// Amount-bearing vs amount-less text, matching hasAmountEvidence's rule
// (a digit or a number word) without re-testing that rule itself here.
const TEXT_WITH_AMOUNT = 'coffee 4';
const TEXT_WITHOUT_AMOUNT = 'call me back';

interface FakeParse {
  amount: number | null;
  label: string;
}

const USEFUL: FakeParse = { amount: 500, label: 'useful' };
const WEAK: FakeParse = { amount: null, label: 'weak' };
const REFUSAL: FakeParse = { amount: null, label: 'refusal' };

defineFeature(feature, (test) => {
  let text: string;
  let scripted: Array<'useful' | 'weak' | 'refusal' | 'throw' | 'null'>;
  let result: DeviceParseAttemptsResult<FakeParse>;

  const givenAmountText = (given: any) =>
    given('text with amount evidence', () => {
      text = TEXT_WITH_AMOUNT;
    });
  const givenNoAmountText = (given: any) =>
    given('text with no amount evidence', () => {
      text = TEXT_WITHOUT_AMOUNT;
    });
  const givenAttempts = (and: any) =>
    and(/^attempts that return: (.+)$/, (script: string) => {
      scripted = script.split(', ').map((s) => s.trim() as 'useful' | 'weak' | 'refusal' | 'throw' | 'null');
    });
  const whenRun = (when: any, finalRefusals = false) =>
    when(finalRefusals ? 'the attempts run with refusals marked final' : 'the attempts run', async () => {
      let i = 0;
      // `'null'` is a DISTINCT script token from running past the end of
      // `scripted` (both would otherwise fall through the same `return null`
      // below) — it exists to kill the `last = parsed ?? last` -> `last =
      // parsed` mutant: an attempt that EXPLICITLY returns `null` (as
      // opposed to a weak-but-non-null parse) must still leave a previously
      // recorded weak result in place, never overwrite it with `null`.
      const attempt = async (): Promise<FakeParse | null> => {
        const step = scripted[i];
        i += 1;
        if (step === 'throw') throw new Error('generation failed');
        if (step === 'useful') return USEFUL;
        if (step === 'weak') return WEAK;
        if (step === 'refusal') return REFUSAL;
        if (step === 'null') return null;
        return null;
      };
      result = await runDeviceParseAttempts(
        text,
        attempt,
        finalRefusals ? (p) => p.label === 'refusal' : undefined
      );
    });

  test('A useful result on the first try needs no retry', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the useful parse', () => {
      expect(result.parse).toEqual(USEFUL);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('A weak result followed by a useful one retries once', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the useful parse', () => {
      expect(result.parse).toEqual(USEFUL);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('A weak result followed by a throw returns the weak result', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the weak parse', () => {
      expect(result.parse).toEqual(WEAK);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('A throw followed by a weak result returns the weak result', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the weak parse', () => {
      expect(result.parse).toEqual(WEAK);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('Both attempts throwing returns null', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is null', () => {
      expect(result.parse).toBeNull();
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('Text with no amount evidence never retries, even on a weak result', ({ given, and, when, then }) => {
    givenNoAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the weak parse', () => {
      expect(result.parse).toEqual(WEAK);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('A weak result followed by an explicit null return keeps the weak result', ({
    given,
    and,
    when,
    then,
  }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the weak parse', () => {
      expect(result.parse).toEqual(WEAK);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('A result the caller marks final is not retried', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when, true);
    then('the result is the refusal', () => {
      expect(result.parse).toEqual(REFUSAL);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });

  test('Without a final marker the same result is retried', ({ given, and, when, then }) => {
    givenAmountText(given);
    givenAttempts(and);
    whenRun(when);
    then('the result is the useful parse', () => {
      expect(result.parse).toEqual(USEFUL);
    });
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => {
      expect(result.attempts).toBe(Number(n));
    });
    and(/^(\d+) attempts? threw$/, (n: string) => {
      expect(result.threw).toBe(Number(n));
    });
  });
});

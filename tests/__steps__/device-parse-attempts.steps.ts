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

defineFeature(feature, (test) => {
  let text: string;
  let scripted: Array<'useful' | 'weak' | 'throw'>;
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
      scripted = script.split(', ').map((s) => s.trim() as 'useful' | 'weak' | 'throw');
    });
  const whenRun = (when: any) =>
    when('the attempts run', async () => {
      let i = 0;
      const attempt = async (): Promise<FakeParse | null> => {
        const step = scripted[i];
        i += 1;
        if (step === 'throw') throw new Error('generation failed');
        if (step === 'useful') return USEFUL;
        if (step === 'weak') return WEAK;
        return null;
      };
      result = await runDeviceParseAttempts(text, attempt);
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
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  confidenceBucket,
  amountDeltaBucket,
  isAmountMaterial,
  isNameMaterial,
  isDateMaterial,
} from '../../src/domain/parseMetrics';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/parse-metrics.feature')
);

/** Build a local-time epoch from "YYYY-MM-DD" + "HH:MM". */
function localMs(ymd: string, hm: string): number {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

defineFeature(feature, (test) => {
  test('Confidence maps to a 0-4 bucket', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('Top confidence clamps to the highest bucket', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('Mid confidence buckets correctly', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('A tiny amount change is not material', ({ given, then, and }) => {
    let before = 0;
    let after = 0;
    given(
      /^a proposed amount of (\d+) and a saved amount of (\d+)$/,
      (b: string, a: string) => {
        before = Number(b);
        after = Number(a);
      }
    );
    then('the amount edit should not be material', () => {
      expect(isAmountMaterial(before, after)).toBe(false);
    });
    and(/^the amount delta bucket should be (\d+)$/, (expected: string) => {
      expect(amountDeltaBucket(before, after)).toBe(Number(expected));
    });
  });

  test('A real amount correction is material', ({ given, then, and }) => {
    let before = 0;
    let after = 0;
    given(
      /^a proposed amount of (\d+) and a saved amount of (\d+)$/,
      (b: string, a: string) => {
        before = Number(b);
        after = Number(a);
      }
    );
    then('the amount edit should be material', () => {
      expect(isAmountMaterial(before, after)).toBe(true);
    });
    and(/^the amount delta bucket should be (\d+)$/, (expected: string) => {
      expect(amountDeltaBucket(before, after)).toBe(Number(expected));
    });
  });

  test('A near-typo payee fix is not material', ({ given, then }) => {
    let material = true;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should not be material', () => {
      expect(material).toBe(false);
    });
  });

  test('A different payee is material', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should be material', () => {
      expect(material).toBe(true);
    });
  });

  test('Adding a payee that was missing is material', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should be material', () => {
      expect(material).toBe(true);
    });
  });

  test('Same calendar day is not a material date change', ({ given, then }) => {
    let material = true;
    given(
      /^a proposed date (.*) at (.*) and a saved date (.*) at (.*)$/,
      (bd: string, bt: string, ad: string, at: string) => {
        material = isDateMaterial(localMs(bd, bt), localMs(ad, at));
      }
    );
    then('the date edit should not be material', () => {
      expect(material).toBe(false);
    });
  });

  test('A different day is a material date change', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed date (.*) at (.*) and a saved date (.*) at (.*)$/,
      (bd: string, bt: string, ad: string, at: string) => {
        material = isDateMaterial(localMs(bd, bt), localMs(ad, at));
      }
    );
    then('the date edit should be material', () => {
      expect(material).toBe(true);
    });
  });
});

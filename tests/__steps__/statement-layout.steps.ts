import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { reconstructLayout, StatementLayout, LayoutRow } from '../../src/domain/statementLayout';
import { OcrObservation } from '../../src/domain/ocrObservation';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'statement-layout.feature'));

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'statement');

function loadFixture(name: string): OcrObservation[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.observations.json`), 'utf8');
  return JSON.parse(raw).observations;
}

/** Criterion 5's scale/shift invariance is about the algorithm's
 *  NON-geometric decisions (which lines become which row, values, order,
 *  description) — `band`/`amountBand` (row-snippet-spec.md) are geometry,
 *  so they're SUPPOSED to move with a scaled/shifted copy. Strips BOTH
 *  geometric fields before comparing everything else. */
function stripBands(rows: LayoutRow[]) {
  return rows.map(({ band, amountBand, ...rest }) => {
    void band;
    void amountBand;
    return rest;
  });
}

const BAND_EPS = 8; // decimal places for toBeCloseTo — floating-point noise only.

function expectBandCloseTo(actual: LayoutRow['band'], expected: LayoutRow['band']): void {
  expect(actual.x).toBeCloseTo(expected.x, BAND_EPS);
  expect(actual.y).toBeCloseTo(expected.y, BAND_EPS);
  expect(actual.w).toBeCloseTo(expected.w, BAND_EPS);
  expect(actual.h).toBeCloseTo(expected.h, BAND_EPS);
}

/** Criterion 7b (QA round 2): the previous version of this check only
 *  asserted `w > 0 && h > 0` on both sides, which a `unionBand` using an
 *  ABSOLUTE offset instead of a PROPORTIONAL one would also have passed.
 *  This asserts every row's `band`/`amountBand` in the SCALED copy equals
 *  the original's band scaled by the same `factor` about the origin — a
 *  union of scaled boxes is the scaled union, since Math.min/max commute
 *  with positive scaling. */
function expectRowsScaledBy(actual: LayoutRow[], expected: LayoutRow[], factor: number): void {
  expect(stripBands(actual)).toEqual(stripBands(expected));
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    expectBandCloseTo(a.band, { x: e.band.x * factor, y: e.band.y * factor, w: e.band.w * factor, h: e.band.h * factor });
    expectBandCloseTo(a.amountBand, {
      x: e.amountBand.x * factor,
      y: e.amountBand.y * factor,
      w: e.amountBand.w * factor,
      h: e.amountBand.h * factor,
    });
  }
}

/** Criterion 7b's shift sibling: a union of TRANSLATED boxes translates the
 *  same amount (x/y shift by `dx`/`dy`) while `w`/`h` stay exactly the same
 *  (translation doesn't change extent) — the case that would catch an
 *  absolute-offset bug scaling would miss (e.g. a hardcoded translate that
 *  happened to equal the scale factor coincidentally). */
function expectRowsShiftedBy(actual: LayoutRow[], expected: LayoutRow[], dx: number, dy: number): void {
  expect(stripBands(actual)).toEqual(stripBands(expected));
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    expectBandCloseTo(a.band, { x: e.band.x + dx, y: e.band.y + dy, w: e.band.w, h: e.band.h });
    expectBandCloseTo(a.amountBand, { x: e.amountBand.x + dx, y: e.amountBand.y + dy, w: e.amountBand.w, h: e.amountBand.h });
  }
}

defineFeature(feature, (test) => {
  let observations: OcrObservation[];
  let layout: StatementLayout;
  let observationsB: OcrObservation[];
  let layoutB: StatementLayout;

  const givenFixture = (given: any) =>
    given(/^the "(.*)" statement fixture$/, (name: string) => {
      observations = loadFixture(name);
    });

  // QA MAJOR 1/2/MINOR 4 scenarios build observations inline (a real
  // screenshot fixture for these would be a lot of noise for one geometric
  // edge case) — a Gherkin data table of text/x/y/w/h rows.
  const givenSyntheticObservations = (given: any) =>
    given(
      /^a synthetic layout with these observations:$/,
      (table: Array<{ text: string; x: string; y: string; w: string; h: string }>) => {
        observations = table.map((r) => ({
          text: r.text,
          x: Number(r.x),
          y: Number(r.y),
          w: Number(r.w),
          h: Number(r.h),
        }));
      }
    );

  const thenRowDescriptionsContain = (and: any) =>
    and(/^the row descriptions should contain, in order: (.*)$/, (list: string) => {
      const expected = list.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      expect(layout.rows).toHaveLength(expected.length);
      expected.forEach((substring, i) => {
        expect(layout.rows[i]!.description).toContain(substring);
      });
    });

  const thenEveryRowCurrencyIs = (and: any) =>
    and(/^every row currency should be (null|"[A-Z]*")$/, (raw: string) => {
      const expected = raw === 'null' ? null : raw.replace(/^"|"$/g, '');
      for (const row of layout.rows) expect(row.currency).toBe(expected);
    });

  const thenHeaderTextContains = (and: any) =>
    and(/^the header text should contain "(.*)"$/, (substring: string) => {
      expect(layout.headerText).toContain(substring);
    });

  test('bank1 — six rows, desktop-style list, amount on the same line as the description', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixture(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    and(/^the row values should be (.*)$/, (list: string) => {
      const expected = list.split(',').map((s) => Number(s.trim()));
      expect(layout.rows.map((r) => r.value)).toEqual(expected);
    });
    and(/^every row sign should be "(.*)"$/, (sign: string) => {
      for (const row of layout.rows) expect(row.sign).toBe(sign);
    });
    and(/^every row dateText should be "(.*)"$/, (dateText: string) => {
      for (const row of layout.rows) expect(row.dateText).toBe(dateText);
    });
    and(/^the unreadRows count should be (\d+)$/, (n: string) => {
      expect(layout.unreadRows).toBe(Number(n));
    });
    and(/^no row value should be (\d+) or (\d+)$/, (a: string, b: string) => {
      for (const row of layout.rows) {
        expect(row.value).not.toBe(Number(a));
        expect(row.value).not.toBe(Number(b));
      }
    });
    thenRowDescriptionsContain(and);
    thenEveryRowCurrencyIs(and);
  });

  test('OCBC — four rows, amount printed on its own line below the description', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixture(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    const rowStep = (n: string, value: string, sign: string, dateText: string) => {
      const row = layout.rows[Number(n) - 1]!;
      expect(row.value).toBe(Number(value));
      expect(row.sign).toBe(sign);
      expect(row.dateText).toBe(dateText);
    };
    const ROW_RE = /^row (\d+) should be ([\d.]+), "(.*)", "(.*)"$/;
    and(ROW_RE, rowStep);
    and(ROW_RE, rowStep);
    and(ROW_RE, rowStep);
    and(ROW_RE, rowStep);
    and('no row value should equal a reference number', () => {
      // The sanitised OCBC fixture's reference tokens are synthetic
      // digit runs like "3074185296…" — none of those should ever have
      // been read as a row's amount.
      for (const row of layout.rows) {
        expect(String(row.value)).not.toMatch(/\d{6,}/);
      }
    });
    thenRowDescriptionsContain(and);
    thenEveryRowCurrencyIs(and);
  });

  test('A receipt classifies as receipt, not a statement, and is never split into rows', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixture(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    and(/^the receipt total value should be (.*)$/, (value: string) => {
      expect(layout.receiptTotal?.value).toBeCloseTo(Number(value), 5);
    });
    and(/^the unreadRows count should be (\d+)$/, (n: string) => {
      expect(layout.unreadRows).toBe(Number(n));
    });
  });

  test("Honesty — every row's amount is one real observation, verbatim", ({ given, when, then, and }) => {
    givenFixture(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then("every row's amountText should be the trimmed text of exactly one observation", () => {
      for (const row of layout.rows) {
        const matches = observations.filter((o) => o.text.trim() === row.amountText);
        expect(matches).toHaveLength(1);
      }
    });
    and("every row's value should be the number printed in its amountText", () => {
      for (const row of layout.rows) {
        const printed = /(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/.exec(row.amountText);
        expect(printed).not.toBeNull();
        expect(row.value).toBe(parseFloat(printed![1]!.replace(/,/g, '')));
      }
    });
    and('the receipt total, if present, should be the trimmed text of exactly one observation', () => {
      if (!layout.receiptTotal) return;
      const matches = observations.filter((o) => o.text.trim() === layout.receiptTotal!.text);
      expect(matches).toHaveLength(1);
    });
  });

  test('Scaling every box by 0.5 yields identical rows — thresholds are relative', ({
    given,
    and,
    when,
    then,
  }) => {
    givenFixture(given);
    and('a copy of that fixture with every box scaled by 0.5', () => {
      observationsB = observations.map((o) => ({
        ...o,
        x: o.x * 0.5,
        y: o.y * 0.5,
        w: o.w * 0.5,
        h: o.h * 0.5,
      }));
    });
    when('I reconstruct both layouts', () => {
      layout = reconstructLayout(observations);
      layoutB = reconstructLayout(observationsB);
    });
    then('the rows should be identical', () => {
      expectRowsScaledBy(layoutB.rows, layout.rows, 0.5);
    });
  });

  test('Shifting every box by +0.1 yields identical rows — thresholds are relative', ({
    given,
    and,
    when,
    then,
  }) => {
    givenFixture(given);
    and('a copy of that fixture with every box shifted by 0.1', () => {
      observationsB = observations.map((o) => ({ ...o, x: o.x + 0.1, y: o.y + 0.1 }));
    });
    when('I reconstruct both layouts', () => {
      layout = reconstructLayout(observations);
      layoutB = reconstructLayout(observationsB);
    });
    then('the rows should be identical', () => {
      expectRowsShiftedBy(layoutB.rows, layout.rows, 0.1, 0.1);
    });
  });

  test("The joined text is the observations' own text, in input order", ({ given, when, then }) => {
    givenFixture(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then("the layout text should equal the fixture's observation text joined by newlines", () => {
      expect(layout.text).toBe(observations.map((o) => o.text).join('\n'));
    });
  });

  test(
    'A dual-currency line among uniformly-spaced rows is 1 unread row, not a lost row (QA MAJOR 1 / follow-up)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the row values should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => Number(s.trim()));
        expect(layout.rows.map((r) => r.value)).toEqual(expected);
      });
      thenRowDescriptionsContain(and);
      and(/^the unreadRows count should be (\d+)$/, (n: string) => {
        expect(layout.unreadRows).toBe(Number(n));
      });
    }
  );

  test(
    'A dual-currency MIDDLE row among uniform single-line rows is 1 unread row, flanked rows survive (QA follow-up item 2)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the row values should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => Number(s.trim()));
        expect(layout.rows.map((r) => r.value)).toEqual(expected);
      });
      thenRowDescriptionsContain(and);
      and(/^the unreadRows count should be (\d+)$/, (n: string) => {
        expect(layout.unreadRows).toBe(Number(n));
      });
    }
  );

  test('Uniformly-spaced single-line rows split one row per line, not a table (QA MAJOR 2a)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenSyntheticObservations(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    and(/^the row values should be (.*)$/, (list: string) => {
      const expected = list.split(',').map((s) => Number(s.trim()));
      expect(layout.rows.map((r) => r.value)).toEqual(expected);
    });
    thenRowDescriptionsContain(and);
    and(/^the unreadRows count should be (\d+)$/, (n: string) => {
      expect(layout.unreadRows).toBe(Number(n));
    });
  });

  test(
    'Uniformly-spaced amount-only/description-only lines with NO jump signal stay a table, counted per unread row (QA MAJOR 2b / M3 root cause)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the unreadRows count should be (\d+)$/, (n: string) => {
        expect(layout.unreadRows).toBe(Number(n));
      });
    }
  );

  test(
    'The same uniform gap, perturbed by floating-point noise, still stays one honest table (QA re-gate)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the unreadRows count should be (\d+)$/, (n: string) => {
        expect(layout.unreadRows).toBe(Number(n));
      });
    }
  );

  test(
    'A single two-line OCBC-style row is always one correct row, whatever its one gap happens to be',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the row values should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => Number(s.trim()));
        expect(layout.rows.map((r) => r.value)).toEqual(expected);
      });
      and(/^every row sign should be "(.*)"$/, (sign: string) => {
        for (const row of layout.rows) expect(row.sign).toBe(sign);
      });
      thenRowDescriptionsContain(and);
    }
  );

  test('A weekday-prefixed date header is still recognised as a date line (MINOR 4, QA)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenSyntheticObservations(given);
    when('I reconstruct the layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    and(/^every row dateText should be "(.*)"$/, (dateText: string) => {
      for (const row of layout.rows) expect(row.dateText).toBe(dateText);
    });
  });

  test(
    "A single sub-pixel gap can't distort the threshold and glue an amount to the wrong description (reviewer B1)",
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the unreadRows count should be (\d+)$/, (n: string) => {
        expect(layout.unreadRows).toBe(Number(n));
      });
    }
  );

  test(
    'A "Total balance" header above ordinary rows is not a receipt (reviewer B2a)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^the layout kind should be "(.*)"$/, (kind: string) => {
        expect(layout.kind).toBe(kind);
      });
      and(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the row values should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => Number(s.trim()));
        expect(layout.rows.map((r) => r.value)).toEqual(expected);
      });
      thenHeaderTextContains(and);
    }
  );

  test(
    'An "Amount due" header above ordinary rows is not a receipt (reviewer B2b)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^the layout kind should be "(.*)"$/, (kind: string) => {
        expect(layout.kind).toBe(kind);
      });
      and(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
    }
  );

  test(
    'A single-item receipt with only a footer Total below it is still a receipt (reviewer B2c)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^the layout kind should be "(.*)"$/, (kind: string) => {
        expect(layout.kind).toBe(kind);
      });
      and(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the receipt total value should be (.*)$/, (value: string) => {
        expect(layout.receiptTotal?.value).toBeCloseTo(Number(value), 5);
      });
    }
  );

  test(
    "A dated transaction list with a footer Total is a statement, and the footer isn't a row (reviewer B2d)",
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^the layout kind should be "(.*)"$/, (kind: string) => {
        expect(layout.kind).toBe(kind);
      });
      and(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^the row values should be (.*)$/, (list: string) => {
        const expected = list.split(',').map((s) => Number(s.trim()));
        expect(layout.rows.map((r) => r.value)).toEqual(expected);
      });
    }
  );

  test(
    'A currency code that itself contains "CR"/"DR" doesn\'t fool the sign reader (reviewer MINOR 1)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^every row sign should be "(.*)"$/, (sign: string) => {
        for (const row of layout.rows) expect(row.sign).toBe(sign);
      });
    }
  );

  test(
    'A "2 Pending" line is not mistaken for a date, and doesn\'t split blocks (reviewer MINOR 2)',
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      and(/^every row dateText should be "(.*)"$/, (dateText: string) => {
        for (const row of layout.rows) expect(row.dateText).toBe(dateText);
      });
      thenHeaderTextContains(and);
    }
  );

  test(
    "A row's own currency is read from its amount token (reviewer B3)",
    ({ given, when, then, and }) => {
      givenSyntheticObservations(given);
      when('I reconstruct the layout', () => {
        layout = reconstructLayout(observations);
      });
      then(/^there should be (\d+) rows$/, (n: string) => {
        expect(layout.rows).toHaveLength(Number(n));
      });
      thenEveryRowCurrencyIs(and);
    }
  );
});

import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { reconstructLayout, StatementLayout, LayoutRow, SourceBand } from '../../src/domain/statementLayout';
import {
  rowsToDrafts,
  applyReceiptTotal,
  applyLayoutAmount,
  StatementDraftContext,
} from '../../src/domain/statementDrafts';
import { computeSnippetWindow, SnippetWindow } from '../../src/domain/snippetWindow';
import { TransactionDraft } from '../../src/domain/assistant';
import { Account } from '../../src/domain/types';
import { OcrObservation } from '../../src/domain/ocrObservation';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'row-snippet.feature'));

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'statement');

function loadFixtureObservations(name: string): OcrObservation[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.observations.json`), 'utf8');
  return JSON.parse(raw).observations;
}

/** "2026-09-02T12:00" → epoch ms at that LOCAL date/time — same idiom as
 *  statement-drafts.steps.ts's own parseLocal. */
function parseLocal(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Unparseable local timestamp: ${s}`);
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0).getTime();
}

/** `band` fully contains `obs`'s box — the honesty check (criterion 2): the
 *  strip a card shows must always cover the exact observation whose text is
 *  the row's own amountText. A tiny epsilon absorbs floating-point noise
 *  from the min/max union math, never a real gap. */
function bandContains(band: SourceBand, obs: { x: number; y: number; w: number; h: number }): void {
  const EPS = 1e-9;
  expect(band.x).toBeLessThanOrEqual(obs.x + EPS);
  expect(band.y).toBeLessThanOrEqual(obs.y + EPS);
  expect(band.x + band.w).toBeGreaterThanOrEqual(obs.x + obs.w - EPS);
  expect(band.y + band.h).toBeGreaterThanOrEqual(obs.y + obs.h - EPS);
}

/** A minimal-but-complete TransactionDraft literal — same idiom as
 *  scan-route.steps.ts's own makeDraft. */
function makeDraft(type: TransactionDraft['type'], amount: number, currency: string): TransactionDraft {
  return {
    accountId: 'acc-main',
    type,
    amount,
    currency,
    categoryName: null,
    payeeName: 'Some Shop',
    note: null,
    occurredAt: Date.now(),
    source: 'ai',
    defaulted: { account: false, payee: false, category: true, date: false },
  };
}

/** A minimal-but-complete LayoutRow literal, banded at the given rectangle
 *  (same rectangle used for both `band` and `amountBand`, since these
 *  scenarios only exercise the row-level plumbing, not the amount/row
 *  distinction) — same idiom as scan-route.steps.ts's own makeRow. */
function makeBandedRow(value: number, currency: string, band: SourceBand): LayoutRow {
  return {
    dateText: null,
    value,
    sign: '-',
    description: 'Row',
    amountText: String(value),
    currency,
    band,
    amountBand: band,
  };
}

/** Independent re-derivation of computeSnippetWindow's own padding formula
 *  (row-snippet-spec.md §4.4: "band grown vertically by 0.15×band.h on EACH
 *  side, clamped to [0,1]") — used to pin criterion 2d's exact numbers
 *  without calling into the module under test, so this is a real regression
 *  anchor rather than a tautology. */
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function expectedPaddedBand(band: SourceBand): SourceBand {
  const pad = 0.15 * band.h;
  const top = clamp01(band.y - pad);
  const bottom = clamp01(band.y + band.h + pad);
  const left = clamp01(band.x);
  const right = clamp01(band.x + band.w);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/** The UNCLIPPED padded height, in px, at the given card width/image —
 *  `full` in row-snippet-spec.md §4.4, before the `maxHeight` cap. Shared
 *  by every scenario that needs to prove a band genuinely exceeds (or
 *  doesn't exceed) the strip's cap, rather than trusting
 *  computeSnippetWindow's own clipped `height` output to prove the premise
 *  of the very scenario it's being used to test. */
function fullPxFor(band: SourceBand, containerWidth: number, imageW: number, imageH: number): number {
  const padded = expectedPaddedBand(band);
  const dispW = containerWidth / padded.w;
  const dispH = dispW * (imageH / imageW);
  return padded.h * dispH;
}

defineFeature(feature, (test) => {
  let observations: OcrObservation[];
  let layout: StatementLayout;
  let account: Account;
  let now: number;
  let drafts: TransactionDraft[];
  let plainDraft: TransactionDraft;
  let appliedDraft: TransactionDraft;
  let snippetInput: {
    band: SourceBand;
    amountBand: SourceBand;
    containerWidth: number;
    image: { width: number; height: number };
  };
  let snippetResult: SnippetWindow | null;

  const givenFixtureLayout = (given: any) =>
    given(/^the "(.*)" statement fixture reconstructed as a layout$/, (name: string) => {
      observations = loadFixtureObservations(name);
      layout = reconstructLayout(observations);
    });

  const givenAccount = (and: any) =>
    and(/^the account "(.*)" in (.*)$/, (name: string, currency: string) => {
      account = { id: 'acc-main', name, currency, openingBalance: 0 };
    });

  const givenNow = (and: any) =>
    and(/^now is (\S+) local$/, (raw: string) => {
      now = parseLocal(raw.replace(/^"|"$/g, ''));
    });

  const givenPlainDraft = (given: any) =>
    given(
      /^a plain (expense|income|transfer) draft for (\d+) minor units in (.*)$/,
      (type: string, amount: string, currency: string) => {
        plainDraft = makeDraft(type as TransactionDraft['type'], Number(amount), currency);
      }
    );

  test('bank1 — every row has a valid normalised band', ({ given, then, and }) => {
    givenFixtureLayout(given);
    then("every row's band should have a positive width and height", () => {
      for (const row of layout.rows) {
        expect(row.band.w).toBeGreaterThan(0);
        expect(row.band.h).toBeGreaterThan(0);
      }
    });
    and("every row's band should sit within the 0..1 normalised frame", () => {
      for (const row of layout.rows) {
        expect(row.band.x).toBeGreaterThanOrEqual(0);
        expect(row.band.y).toBeGreaterThanOrEqual(0);
        expect(row.band.x + row.band.w).toBeLessThanOrEqual(1);
        expect(row.band.y + row.band.h).toBeLessThanOrEqual(1);
      }
    });
  });

  test("Honesty — a row's band and amountBand contain the observation that produced its amountText", ({
    given,
    then,
    and,
  }) => {
    givenFixtureLayout(given);
    then("every row's band should contain the fixture observation matching its own amountText", () => {
      expect(layout.rows.length).toBeGreaterThan(0);
      for (const row of layout.rows) {
        const obs = observations.find((o) => o.text.trim() === row.amountText);
        expect(obs).toBeDefined();
        bandContains(row.band, obs!);
      }
    });
    and("every row's amountBand should contain the fixture observation matching its own amountText", () => {
      for (const row of layout.rows) {
        const obs = observations.find((o) => o.text.trim() === row.amountText);
        expect(obs).toBeDefined();
        bandContains(row.amountBand, obs!);
      }
    });
    and("every row's amountBand should be fully contained within its own band", () => {
      // amountBand is the LINE carrying the amount — a strict subset
      // rectangle of the whole-block band (row-snippet-spec.md §4.1), not
      // merely no taller: `computeSnippetWindow`'s own defensive union
      // (reviewer nit 2) means a violation here wouldn't break the app, but
      // this positively pins the premise on the real fixtures rather than
      // only defending against it never being tested at all.
      for (const row of layout.rows) {
        bandContains(row.band, row.amountBand);
      }
    });
  });

  test("OCBC row 1 — a multi-line row's band spans every line, not just the amount's own line", ({
    given,
    then,
  }) => {
    givenFixtureLayout(given);
    then("row 1's band height should be well beyond any single line's height in the fixture", () => {
      // Every OCBC row is a several-line block (description, reference,
      // "Advice • ADV", then the amount on its own line) — a band that only
      // covered the amount observation's own line would be roughly one
      // line's height; the real union spans the whole block, several times
      // taller (row-snippet-spec.md §5 criterion 3).
      const maxSingleObservationHeight = Math.max(...observations.map((o) => o.h));
      expect(layout.rows[0]!.band.h).toBeGreaterThan(maxSingleObservationHeight * 2);
    });
  });

  test('Window honesty — the visible strip always contains the amount, even when the band is too tall (QA round 1 Major)', ({
    given,
    then,
  }) => {
    givenFixtureLayout(given);
    then(
      /^at containerWidth (\d+) and image (\d+)x(\d+), every row's snippet window should contain its amountBand's y-range$/,
      (containerWidth: string, imgW: string, imgH: string) => {
        expect(layout.rows.length).toBeGreaterThan(0);
        const image = { width: Number(imgW), height: Number(imgH) };
        for (const row of layout.rows) {
          const win = computeSnippetWindow({
            band: row.band,
            amountBand: row.amountBand,
            containerWidth: Number(containerWidth),
            image,
            maxHeight: 96,
          });
          expect(win).not.toBeNull();
          const visibleTop = -win!.translateY / win!.dispH;
          const visibleBottom = visibleTop + win!.height / win!.dispH;
          const amtTop = row.amountBand.y;
          const amtBottom = row.amountBand.y + row.amountBand.h;
          const EPS = 1e-9;
          expect(visibleTop).toBeLessThanOrEqual(amtTop + EPS);
          expect(visibleBottom).toBeGreaterThanOrEqual(amtBottom - EPS);
        }
      }
    );
  });

  test("Window honesty's own premise — every ocbc row's band genuinely exceeds the strip's cap (reviewer nit 3)", ({
    given,
    then,
  }) => {
    givenFixtureLayout(given);
    then(
      /^every row's unclipped padded height in pixels at containerWidth (\d+) and image (\d+)x(\d+) should exceed (\d+)$/,
      (containerWidth: string, imgW: string, imgH: string, pxThreshold: string) => {
        expect(layout.rows.length).toBeGreaterThan(0);
        for (const row of layout.rows) {
          const fullPx = fullPxFor(row.band, Number(containerWidth), Number(imgW), Number(imgH));
          expect(fullPx).toBeGreaterThan(Number(pxThreshold));
        }
      }
    );
  });

  test('computeSnippetWindow returns null for invalid input', ({ given, when, then }) => {
    given(
      /^a snippet window request with containerWidth ([\d.]+), image (\d+)x(\d+), and a band (.+)$/,
      (containerWidth: string, imgW: string, imgH: string, bandDesc: string) => {
        let band: SourceBand;
        if (bandDesc === 'zero-width') band = { x: 0.1, y: 0.2, w: 0, h: 0.05 };
        else if (bandDesc === 'zero-height') band = { x: 0.1, y: 0.2, w: 0.3, h: 0 };
        else {
          const [x, y, w, h] = bandDesc.split(',').map((n) => Number(n.trim()));
          band = { x: x!, y: y!, w: w!, h: h! };
        }
        snippetInput = {
          band,
          amountBand: band,
          containerWidth: Number(containerWidth),
          image: { width: Number(imgW), height: Number(imgH) },
        };
      }
    );
    when('I compute the snippet window', () => {
      snippetResult = computeSnippetWindow({ ...snippetInput, maxHeight: 96 });
    });
    then('the snippet window should be null', () => {
      expect(snippetResult).toBeNull();
    });
  });

  test('computeSnippetWindow leaves a fitting band unchanged', ({ given, when, then, and }) => {
    given(
      /^a snippet window request with containerWidth ([\d.]+), image (\d+)x(\d+), and a band ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/,
      (containerWidth: string, imgW: string, imgH: string, x: string, y: string, w: string, h: string) => {
        const band: SourceBand = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        snippetInput = {
          band,
          amountBand: band,
          containerWidth: Number(containerWidth),
          image: { width: Number(imgW), height: Number(imgH) },
        };
      }
    );
    when('I compute the snippet window', () => {
      snippetResult = computeSnippetWindow({ ...snippetInput, maxHeight: 96 });
    });
    then('the snippet window should not be null', () => {
      expect(snippetResult).not.toBeNull();
    });
    and("the window's translateY should equal -padded.y × dispH", () => {
      const padded = expectedPaddedBand(snippetInput.band);
      const dispW = snippetInput.containerWidth / padded.w;
      const dispH = dispW * (snippetInput.image.height / snippetInput.image.width);
      expect(snippetResult!.translateY).toBeCloseTo(-padded.y * dispH, 6);
    });
    and("the window's height should equal the unclipped padded height", () => {
      const padded = expectedPaddedBand(snippetInput.band);
      const dispW = snippetInput.containerWidth / padded.w;
      const dispH = dispW * (snippetInput.image.height / snippetInput.image.width);
      expect(snippetResult!.height).toBeCloseTo(padded.h * dispH, 6);
    });
  });

  test("computeSnippetWindow never clips into the amount's own top edge, even with nominal room to spare (QA round 3 Minor)", ({
    given,
    when,
    then,
    and,
  }) => {
    given(
      /^a snippet window request with containerWidth ([\d.]+), image (\d+)x(\d+), and a band ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+) with amount line at ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/,
      (
        containerWidth: string,
        imgW: string,
        imgH: string,
        bx: string,
        by: string,
        bw: string,
        bh: string,
        ax: string,
        ay: string,
        aw: string,
        ah: string
      ) => {
        snippetInput = {
          band: { x: Number(bx), y: Number(by), w: Number(bw), h: Number(bh) },
          amountBand: { x: Number(ax), y: Number(ay), w: Number(aw), h: Number(ah) },
          containerWidth: Number(containerWidth),
          image: { width: Number(imgW), height: Number(imgH) },
        };
      }
    );
    when('I compute the snippet window', () => {
      snippetResult = computeSnippetWindow({ ...snippetInput, maxHeight: 96 });
    });
    then('the snippet window should not be null', () => {
      expect(snippetResult).not.toBeNull();
    });
    and("the window's visible top should equal the amount's own top exactly", () => {
      const visibleTop = -snippetResult!.translateY / snippetResult!.dispH;
      expect(visibleTop).toBeCloseTo(snippetInput.amountBand.y, 9);
    });
  });

  test('receiptTotal with the TOTAL label and its amount on different lines — band spans both, amountBand is the amount alone (D6)', ({
    given,
    when,
    then,
    and,
  }) => {
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
    when('I reconstruct that synthetic layout', () => {
      layout = reconstructLayout(observations);
    });
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^the receiptTotal band should contain the fixture observation "(.*)"$/, (text: string) => {
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      expect(layout.receiptTotal).not.toBeNull();
      bandContains(layout.receiptTotal!.band, obs!);
    });
    and(/^the receiptTotal band should contain the fixture observation "(.*)"$/, (text: string) => {
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      bandContains(layout.receiptTotal!.band, obs!);
    });
    and('the receiptTotal band height should be well beyond a single line\'s height', () => {
      const maxSingleObservationHeight = Math.max(...observations.map((o) => o.h));
      expect(layout.receiptTotal!.band.h).toBeGreaterThan(maxSingleObservationHeight * 1.5);
    });
    and(/^the receiptTotal amountBand should equal the fixture observation "(.*)"$/, (text: string) => {
      // D6: amountBand is unionBand([amountLine]) ALONE — when the amount
      // sits alone on its own line (as here), that's exactly the
      // observation's own box, not the wider TOTAL+amount union (`band`).
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      const amountBand = layout.receiptTotal!.amountBand;
      expect(amountBand.x).toBeCloseTo(obs!.x, 9);
      expect(amountBand.y).toBeCloseTo(obs!.y, 9);
      expect(amountBand.w).toBeCloseTo(obs!.w, 9);
      expect(amountBand.h).toBeCloseTo(obs!.h, 9);
    });
    and(/^the receiptTotal amountBand should not contain the fixture observation "(.*)"$/, (text: string) => {
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      const band = layout.receiptTotal!.amountBand;
      const EPS = 1e-9;
      const contains =
        band.x <= obs!.x + EPS &&
        band.y <= obs!.y + EPS &&
        band.x + band.w >= obs!.x + obs!.w - EPS &&
        band.y + band.h >= obs!.y + obs!.h - EPS;
      expect(contains).toBe(false);
    });
    and("the receiptTotal band should contain its own amountBand", () => {
      bandContains(layout.receiptTotal!.band, layout.receiptTotal!.amountBand);
    });
  });

  test("skewed-receipt fixture — nearest-line pairing keeps the total's snippet honest at real screen dimensions (total-pairing-spec.md criterion 2)", ({
    given,
    then,
    and,
  }) => {
    givenFixtureLayout(given);
    then(/^the receiptTotal band should contain the fixture observation "(.*)"$/, (text: string) => {
      // Two "31.05" observations exist in the fixture (once as the total,
      // once as the tendered amount below the payment method); `.find`
      // takes the FIRST match in Vision order, which is the total's own —
      // the same one nearestAmountLine paired.
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      expect(layout.receiptTotal).not.toBeNull();
      bandContains(layout.receiptTotal!.band, obs!);
    });
    and("the receiptTotal band should contain its own amountBand", () => {
      bandContains(layout.receiptTotal!.band, layout.receiptTotal!.amountBand);
    });
    and(
      /^at containerWidth (\d+) and image (\d+)x(\d+), the receiptTotal's snippet window should contain the amount observation's y-range$/,
      (containerWidth: string, imgW: string, imgH: string) => {
        const rt = layout.receiptTotal!;
        const win = computeSnippetWindow({
          band: rt.band,
          amountBand: rt.amountBand,
          containerWidth: Number(containerWidth),
          image: { width: Number(imgW), height: Number(imgH) },
          maxHeight: 96,
        });
        expect(win).not.toBeNull();
        const visibleTop = -win!.translateY / win!.dispH;
        const visibleBottom = visibleTop + win!.height / win!.dispH;
        const amtObs = observations.find((o) => o.text.trim() === rt.text);
        expect(amtObs).toBeDefined();
        const EPS = 1e-9;
        expect(visibleTop).toBeLessThanOrEqual(amtObs!.y + EPS);
        expect(visibleBottom).toBeGreaterThanOrEqual(amtObs!.y + amtObs!.h - EPS);
      }
    );
  });

  test('Honesty (receipt window) — a tall TOTAL block with footer copy between the label and the amount still shows the amount (QA round 2 Major, D6)', ({
    given,
    then,
    and,
  }) => {
    given(
      'a synthetic receipt with SUBTOTAL well above TOTAL, and three footer lines between TOTAL and its printed amount',
      () => {
        // QA round 2's real repro, through the real pipeline (no stubs): a
        // SUBTOTAL block (never a receiptTotal candidate — its signal kind
        // is 'subtotal', not 'total') sits well above a TOTAL block whose
        // amount is separated from the label by three ordinary footer lines
        // (thank-you copy, a QR blurb, …) — spaced so groupIntoBlocks keeps
        // TOTAL + footers + amount as ONE block (uniform ~0.02 internal
        // gaps, all well under the big SUBTOTAL→TOTAL jump that splits
        // them). reconstructLayout still correctly picks S$50.00 over
        // SUBTOTAL's S$45.00 — this scenario is about the WINDOW, not
        // detection.
        observations = [
          { text: 'Subtotal', x: 0.05, y: 0.05, w: 0.15, h: 0.02 },
          { text: 'S$45.00', x: 0.6, y: 0.05, w: 0.15, h: 0.02 },
          { text: 'TOTAL', x: 0.05, y: 0.3, w: 0.15, h: 0.02 },
          { text: 'Thank you for your purchase', x: 0.05, y: 0.34, w: 0.5, h: 0.02 },
          { text: 'Please come again soon', x: 0.05, y: 0.38, w: 0.45, h: 0.02 },
          { text: 'Scan the QR code to rate us', x: 0.05, y: 0.42, w: 0.55, h: 0.02 },
          { text: 'S$50.00', x: 0.75, y: 0.46, w: 0.15, h: 0.02 },
        ];
        layout = reconstructLayout(observations);
      }
    );
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^the receiptTotal value should be (\d+)$/, (value: string) => {
      expect(layout.receiptTotal).not.toBeNull();
      expect(layout.receiptTotal!.value).toBe(Number(value));
    });
    and(
      /^the receiptTotal band height in pixels at containerWidth (\d+) and image (\d+)x(\d+) should exceed (\d+)$/,
      (containerWidth: string, imgW: string, imgH: string, pxThreshold: string) => {
        const fullPx = fullPxFor(layout.receiptTotal!.band, Number(containerWidth), Number(imgW), Number(imgH));
        expect(fullPx).toBeGreaterThan(Number(pxThreshold));
      }
    );
    and("the receiptTotal band should contain its own amountBand", () => {
      bandContains(layout.receiptTotal!.band, layout.receiptTotal!.amountBand);
    });
    and(
      /^at containerWidth (\d+) and image (\d+)x(\d+), the receiptTotal's snippet window should contain the amount observation's y-range$/,
      (containerWidth: string, imgW: string, imgH: string) => {
        const rt = layout.receiptTotal!;
        const win = computeSnippetWindow({
          band: rt.band,
          amountBand: rt.amountBand,
          containerWidth: Number(containerWidth),
          image: { width: Number(imgW), height: Number(imgH) },
          maxHeight: 96,
        });
        expect(win).not.toBeNull();
        const visibleTop = -win!.translateY / win!.dispH;
        const visibleBottom = visibleTop + win!.height / win!.dispH;
        const amtObs = observations.find((o) => o.text.trim() === rt.text);
        expect(amtObs).toBeDefined();
        const EPS = 1e-9;
        expect(visibleTop).toBeLessThanOrEqual(amtObs!.y + EPS);
        expect(visibleBottom).toBeGreaterThanOrEqual(amtObs!.y + amtObs!.h - EPS);
      }
    );
  });

  test('Index-drift regression — a dropped middle row must not leave a later draft with the wrong band', ({
    given,
    and,
    when,
    then,
  }) => {
    givenFixtureLayout(given);
    givenAccount(and);
    givenNow(and);
    and(/^row (\d+) of that layout has its value forced to 0$/, (n: string) => {
      // Same hazard rowsToDrafts itself guards against (statementDrafts.ts):
      // dropping this row's VALUE must not disturb its BAND — the band stays
      // on the row object exactly as reconstructLayout produced it.
      layout.rows[Number(n) - 1]!.value = 0;
    });
    when('I build drafts from the layout', () => {
      const ctx: StatementDraftContext = {
        account,
        accounts: [account],
        payees: [],
        categories: [],
        existing: [],
        now,
      };
      drafts = rowsToDrafts(layout, ctx).drafts;
    });
    then(/^there should be (\d+) drafts$/, (n: string) => {
      expect(drafts).toHaveLength(Number(n));
    });
    and("each draft's sourceBand should equal the band of the row it was actually built from", () => {
      const expectedBands = layout.rows.filter((r) => r.value !== 0).map((r) => r.band);
      expect(drafts.map((d) => d.sourceBand)).toEqual(expectedBands);
    });
    and(/^draft (\d+)'s sourceBand should not equal the band of row (\d+) of the original layout$/, (
      draftN: string,
      rowN: string
    ) => {
      // The regression this criterion pins: a naive `drafts[i] ↔
      // layout.rows[i]` index lookup would read the WRONG (dropped) row's
      // band here, since draft 4 is actually built from row 5 (row 4 was
      // dropped) — this must fail if anyone ever indexes by queue position.
      expect(drafts[Number(draftN) - 1]!.sourceBand).not.toEqual(layout.rows[Number(rowN) - 1]!.band);
    });
  });

  test('receipt fixture — receiptTotal.band contains the TOTAL line, and applyReceiptTotal copies it onto the draft', ({
    given,
    then,
    and,
    when,
  }) => {
    givenFixtureLayout(given);
    then(/^the receiptTotal band should contain the fixture observation "(.*)"$/, (text: string) => {
      const obs = observations.find((o) => o.text.trim() === text);
      expect(obs).toBeDefined();
      expect(layout.receiptTotal).not.toBeNull();
      bandContains(layout.receiptTotal!.band, obs!);
    });
    and("the receiptTotal band should contain its own amountBand", () => {
      bandContains(layout.receiptTotal!.band, layout.receiptTotal!.amountBand);
    });
    givenPlainDraft(and);
    when('I apply the receipt total to that draft', () => {
      appliedDraft = applyReceiptTotal(plainDraft, layout);
    });
    then("the applied draft's sourceBand should equal the layout's receiptTotal band", () => {
      expect(appliedDraft.sourceBand).toEqual(layout.receiptTotal!.band);
    });
    and("the applied draft's sourceAmountBand should equal the layout's receiptTotal amountBand", () => {
      expect(appliedDraft.sourceAmountBand).toEqual(layout.receiptTotal!.amountBand);
    });
  });

  test('Additive smoke check — kind, row count, unreadRows and headerText are undisturbed by band/amountBand', ({
    given,
    then,
    and,
  }) => {
    givenFixtureLayout(given);
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });
    and(/^there should be (\d+) rows$/, (n: string) => {
      expect(layout.rows).toHaveLength(Number(n));
    });
    and(/^the unreadRows count should be (\d+)$/, (n: string) => {
      expect(layout.unreadRows).toBe(Number(n));
    });
    and(/^the header text should contain "(.*)"$/, (substring: string) => {
      expect(layout.headerText).toContain(substring);
    });
  });

  const givenLiteralSingleRowLayout = (given: any) =>
    given(
      /^a single-kind layout with (\d+) unread rows? and a ([\d.]+) (SGD|USD) row banded at ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/,
      (unread: string, value: string, currency: string, x: string, y: string, w: string, h: string) => {
        const band: SourceBand = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        layout = {
          kind: 'single',
          rows: [makeBandedRow(Number(value), currency, band)],
          unreadRows: Number(unread),
          receiptTotal: null,
        } as StatementLayout;
      }
    );

  test("applyLayoutAmount's one-row branch sets sourceBand and sourceAmountBand", ({ given, and, when, then }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    when('I apply the layout amount to that draft', () => {
      appliedDraft = applyLayoutAmount(plainDraft, layout);
    });
    then('the draft should be flagged amount-from-row', () => {
      expect(appliedDraft.amountFromRow).toBe(true);
    });
    and(/^the applied draft's sourceBand should be ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/, (
      x: string,
      y: string,
      w: string,
      h: string
    ) => {
      expect(appliedDraft.sourceBand).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    });
    and(/^the applied draft's sourceAmountBand should be ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/, (
      x: string,
      y: string,
      w: string,
      h: string
    ) => {
      expect(appliedDraft.sourceAmountBand).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    });
  });

  test("applyLayoutAmount's receipt-total branch carries the receipt's own amount-line band, not the whole union (D6)", ({
    given,
    and,
    when,
    then,
  }) => {
    given(
      /^a single-kind layout with a receiptTotal banded at ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+) with amount line at ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+), and a ([\d.]+) (SGD|USD) row$/,
      (
        x: string,
        y: string,
        w: string,
        h: string,
        ax: string,
        ay: string,
        aw: string,
        ah: string,
        value: string,
        currency: string
      ) => {
        const receiptBand: SourceBand = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        // D6 (QA round 2): amountBand is deliberately a DIFFERENT rectangle
        // from `band` — the union of the TOTAL label and the amount is not
        // always tight, so applyReceiptTotal must carry `amountBand` for
        // `sourceAmountBand`, never `band` itself.
        const receiptAmountBand: SourceBand = { x: Number(ax), y: Number(ay), w: Number(aw), h: Number(ah) };
        // The row's own band is deliberately a different rectangle again —
        // proves the applied draft carries the RECEIPT's bands (via
        // applyReceiptTotal, rule 1), not the row's.
        const rowBand: SourceBand = { x: 0, y: 0, w: 1, h: 0.02 };
        layout = {
          kind: 'single',
          rows: [makeBandedRow(Number(value), currency, rowBand)],
          unreadRows: 0,
          receiptTotal: { value: 8.3, text: 'S$8.30', band: receiptBand, amountBand: receiptAmountBand },
        } as StatementLayout;
      }
    );
    givenPlainDraft(and);
    when('I apply the layout amount to that draft', () => {
      appliedDraft = applyLayoutAmount(plainDraft, layout);
    });
    then(/^the applied draft's sourceBand should be ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/, (
      x: string,
      y: string,
      w: string,
      h: string
    ) => {
      expect(appliedDraft.sourceBand).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    });
    and(/^the applied draft's sourceAmountBand should be ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)$/, (
      x: string,
      y: string,
      w: string,
      h: string
    ) => {
      expect(appliedDraft.sourceAmountBand).toEqual({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    });
  });

  test("applyLayoutAmount's unchanged branch returns the exact same draft reference and no sourceBand", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    when('I apply the layout amount to that draft', () => {
      appliedDraft = applyLayoutAmount(plainDraft, layout);
    });
    then('the draft should be unchanged', () => {
      expect(appliedDraft).toBe(plainDraft);
    });
    and("the applied draft's sourceBand should be undefined", () => {
      expect(appliedDraft.sourceBand).toBeUndefined();
    });
    and("the applied draft's sourceAmountBand should be undefined", () => {
      expect(appliedDraft.sourceAmountBand).toBeUndefined();
    });
  });
});

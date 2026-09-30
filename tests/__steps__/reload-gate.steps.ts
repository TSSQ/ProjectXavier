import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { createReloadGate, reloadKey, ReloadGate } from '../../src/domain/reloadGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/reload-gate.feature'));

defineFeature(feature, (test) => {
  let rev: number;
  let currency: string;
  let gate: ReloadGate;

  const givenData = (given: any) =>
    given(/^the data revision is (\d+) and the currency is "(.*)"$/, (r: string, c: string) => {
      rev = Number(r);
      currency = c;
      gate = createReloadGate(async () => reloadKey(rev, currency));
    });
  const loadedOnce = (and: any) =>
    and('the screen has loaded once', async () => {
      expect(await gate.shouldReload()).toBe(true);
    });
  const next = (step: any, text: RegExp, expected: boolean) =>
    step(text, async () => expect(await gate.shouldReload()).toBe(expected));

  test('The first focus always loads', ({ given, then }) => {
    givenData(given);
    next(then, /^the first focus should reload$/, true);
  });

  test('Nothing changed — no reload', ({ given, and, then }) => {
    givenData(given);
    loadedOnce(and);
    next(then, /^the next focus should not reload$/, false);
  });

  test('A write elsewhere bumps the revision — reload, once', ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when(/^the data revision becomes (\d+)$/, (r: string) => { rev = Number(r); });
    next(then, /^the next focus should reload$/, true);
    next(and, /^the focus after that should not reload$/, false);
  });

  test("A currency change reloads though the revision didn't move", ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when(/^the currency becomes "(.*)"$/, (c: string) => { currency = c; });
    next(then, /^the next focus should reload$/, true);
  });

  test('A failed load is retried on the next focus', ({ given, and, then }) => {
    givenData(given);
    and('the screen has loaded once but the load failed', async () => {
      expect(await gate.shouldReload()).toBe(true);
      gate.invalidate(); // what useFocusReload does when refresh() throws
    });
    next(then, /^the next focus should reload$/, true);
  });
});

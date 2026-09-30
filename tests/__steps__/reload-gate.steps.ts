import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { createReloadGate, reloadKey, ReloadGate } from '../../src/domain/reloadGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/reload-gate.feature'));

defineFeature(feature, (test) => {
  let rev: number;
  let currency: string;
  let day: number;
  let gate: ReloadGate;
  // Indirection so the race scenarios below can swap in a controllable
  // reader for a couple of calls, then restore the normal one.
  let reader: () => Promise<string>;
  let firstResult: Promise<boolean>;
  let secondResult: Promise<boolean>;
  // The key as of the last completed load — what an earlier-dispatched call,
  // still mid-read when a later one starts, would resolve to if its own
  // read reflects data from before the later call's read began.
  let revAtLoad: number;

  const givenData = (given: any) =>
    given(/^the data revision is (\d+) and the currency is "(.*)"$/, (r: string, c: string) => {
      rev = Number(r);
      currency = c;
      day = new Date(2026, 8, 29).getTime();
      reader = async () => reloadKey(rev, currency, day);
      gate = createReloadGate(() => reader());
    });
  const loadedOnce = (and: any) =>
    and('the screen has loaded once', async () => {
      expect(await gate.shouldReload()).toBe(true);
      revAtLoad = rev;
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

  test('Midnight passes with no write — reload once for the new day', ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when('the day changes', () => { day = new Date(2026, 8, 30).getTime(); });
    next(then, /^the next focus should reload$/, true);
    next(and, /^the focus after that should not reload$/, false);
  });

  test('A failed load is retried on the next focus', ({ given, and, then }) => {
    givenData(given);
    and('the screen has loaded once but the load failed', async () => {
      expect(await gate.shouldReload()).toBe(true);
      gate.invalidate(); // what useFocusReload does when refresh() throws
    });
    next(then, /^the next focus should reload$/, true);
  });

  // Two concurrent shouldReload() calls whose readKey() promises can settle
  // in either order — dispatch order is not resolution order, and the gate
  // must never let an earlier-dispatched (now stale) call commit after a
  // later-dispatched one already has. The first-dispatched call resolves to
  // the key as of the last load (as if its read had already been in flight
  // before the revision bumped); the second-dispatched call resolves to the
  // current key (its read started after the bump).
  const raceStarts = (when: any) =>
    when(/^two focuses start, and the (first|second) one's read resolves first$/, async (which: string) => {
      let resolveFirst!: (k: string) => void;
      let resolveSecond!: (k: string) => void;
      const pendingFirst = new Promise<string>((res) => { resolveFirst = res; });
      const pendingSecond = new Promise<string>((res) => { resolveSecond = res; });
      let dispatched = 0;
      reader = () => (dispatched++ === 0 ? pendingFirst : pendingSecond);
      const staleKey = reloadKey(revAtLoad, currency, day);
      const freshKey = reloadKey(rev, currency, day);
      firstResult = gate.shouldReload();
      secondResult = gate.shouldReload();
      if (which === 'first') {
        resolveFirst(staleKey);
        await firstResult;
        resolveSecond(freshKey);
        await secondResult;
      } else {
        resolveSecond(freshKey);
        await secondResult;
        resolveFirst(staleKey);
        await firstResult;
      }
      reader = async () => reloadKey(rev, currency, day); // back to normal for later checks
    });
  const raceOutcome = (step: any, which: 'first' | 'second', expected: boolean) =>
    step(new RegExp(`^the ${which} focus should ${expected ? '' : 'not '}reload$`), async () =>
      expect(await (which === 'first' ? firstResult : secondResult)).toBe(expected)
    );

  test('A late-resolving stale call never overwrites a newer commit', ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when(/^the data revision becomes (\d+)$/, (r: string) => { rev = Number(r); });
    raceStarts(and);
    raceOutcome(then, 'second', true);
    raceOutcome(and, 'first', false);
    next(and, /^the next focus should not reload$/, false);
  });

  test('Two focuses that resolve in dispatch order still behave normally', ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when(/^the data revision becomes (\d+)$/, (r: string) => { rev = Number(r); });
    raceStarts(and);
    raceOutcome(then, 'first', false);
    raceOutcome(and, 'second', true);
    next(and, /^the next focus should not reload$/, false);
  });
});

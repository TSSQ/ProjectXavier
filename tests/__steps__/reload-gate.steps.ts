import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { createReloadGate, reloadKey, ReloadGate } from '../../src/domain/reloadGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/reload-gate.feature'));

defineFeature(feature, (test) => {
  let rev: number;
  let currency: string;
  let day: number;
  let gate: ReloadGate;
  // Indirection so a couple of scenarios below can swap in a controllable
  // reader for a few calls, then restore the normal one.
  let reader: () => Promise<string>;
  let firstResult: Promise<boolean>;
  let secondResult: Promise<boolean>;

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

  // Three shouldReload() calls dispatched together, with a controllable
  // reader that counts how many of its own invocations are in flight at
  // once and records the key each one actually saw. The revision is bumped
  // from inside the reader itself, right after it captures the key for one
  // call and before the next call's reader can run — which only a truly
  // serialised gate ever observes, since a non-serialised gate would let
  // several readers run (and see the same revision) concurrently.
  test('Overlapping focuses are checked one at a time', ({ given, and, when, then }) => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seenKeys: string[] = [];
    let results: boolean[];

    givenData(given);
    loadedOnce(and);
    when(/^three focuses start together while the revision changes between reads$/, async () => {
      let calls = 0;
      reader = async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const key = reloadKey(rev, currency, day);
        seenKeys.push(key);
        calls++;
        if (calls === 1) rev = 8; // a write lands between the 1st and 2nd read
        if (calls === 2) rev = 9; // and another between the 2nd and 3rd
        await Promise.resolve();
        inFlight--;
        return key;
      };
      results = await Promise.all([gate.shouldReload(), gate.shouldReload(), gate.shouldReload()]);
      reader = async () => reloadKey(rev, currency, day); // back to normal for the trailing check
    });
    then(/^at most 1 read was ever in flight at once$/, () => {
      expect(maxInFlight).toBe(1);
    });
    and(/^each result matches the key its read actually saw$/, () => {
      // Replay the same "changed since last committed key" rule the gate
      // itself applies, over the keys the reads actually observed, and
      // check it produces exactly the results the gate returned.
      let expectedSeen = reloadKey(7, currency, day); // committed by "loaded once"
      const expected = seenKeys.map((key) => {
        const changed = key !== expectedSeen;
        if (changed) expectedSeen = key;
        return changed;
      });
      expect(results).toEqual(expected);
    });
    next(and, /^the next focus should not reload$/, false);
  });

  // A rejecting read must fail only the call that made it — it must not
  // wedge the chain so that every later call rejects too.
  test("A failed read doesn't block the next check", ({ given, and, when, then }) => {
    givenData(given);
    loadedOnce(and);
    when(/^a focus starts whose read will fail$/, () => {
      reader = () => Promise.reject(new Error('read failed'));
      firstResult = gate.shouldReload();
      firstResult.catch(() => undefined); // observed later via `then`; suppress the transient unhandled-rejection warning
    });
    and(/^another focus starts right behind it$/, () => {
      rev = 8; // something really did change, so the second call has a genuine reload to report
      reader = async () => reloadKey(rev, currency, day);
      secondResult = gate.shouldReload();
    });
    then(/^the first focus should reject$/, async () => {
      await expect(firstResult).rejects.toThrow('read failed');
    });
    and(/^the second focus should reload$/, async () => {
      expect(await secondResult).toBe(true);
    });
  });
});

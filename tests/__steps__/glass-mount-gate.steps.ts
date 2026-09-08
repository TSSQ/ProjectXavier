import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { mayMountGlass, GlassMountSignals } from '../../src/domain/glassMountGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/glass-mount-gate.feature'));

defineFeature(feature, (test) => {
  let signals: GlassMountSignals;

  const givenSignals = (given: any) =>
    given(
      /^tier is "(native|opaque)", entered is (true|false), and measured is (null|set|undefined)$/,
      (tier: string, entered: string, measured: string) => {
        signals = {
          tier: tier as GlassMountSignals['tier'],
          entered: entered === 'true',
          measured: measured === 'set' ? { width: 100, height: 100 } : measured === 'undefined' ? undefined : null,
        };
      }
    );

  const givenSignalsNoEntered = (given: any) =>
    given(
      /^tier is "(native|opaque)" and measured is (null|set), with entered omitted$/,
      (tier: string, measured: string) => {
        signals = {
          tier: tier as GlassMountSignals['tier'],
          measured: measured === 'set' ? { width: 100, height: 100 } : null,
        };
      }
    );

  const thenMayMount = (then: any) =>
    then(/^it should (not )?be allowed to mount$/, (not: string | undefined) => {
      expect(mayMountGlass(signals)).toBe(!not);
    });

  test('The opaque tier never mounts Glass, even once settled', ({ given, then }) => {
    givenSignals(given);
    thenMayMount(then);
  });

  test('The native tier defers while the entering animation is still playing, even once measured', ({
    given,
    then,
  }) => {
    givenSignals(given);
    thenMayMount(then);
  });

  test('The native tier defers until the content has been measured, even once settled', ({ given, then }) => {
    givenSignals(given);
    thenMayMount(then);
  });

  test('The native tier defers when nothing has happened yet', ({ given, then }) => {
    givenSignals(given);
    thenMayMount(then);
  });

  test('The native tier mounts once settled and measured', ({ given, then }) => {
    givenSignals(given);
    thenMayMount(then);
  });

  test('Entered defaults to true for a caller with no entering animation to wait for', ({ given, then }) => {
    givenSignalsNoEntered(given);
    thenMayMount(then);
  });

  test('Measured being undefined defers the same as null', ({ given, then }) => {
    givenSignals(given);
    thenMayMount(then);
  });
});

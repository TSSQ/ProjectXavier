import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  routeEngines,
  resolveByokEnabled,
  RouteContext,
  ByokProvider,
} from '../../src/domain/parseRouter';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/parse-router.feature')
);

defineFeature(feature, (test) => {
  let deviceAiCapable = false;
  let online = true;
  let byokEnabled = false;
  let byokProvider: ByokProvider | null = null;
  let order: string[];
  let resolved: boolean;

  const scenarioSetup = () => {
    deviceAiCapable = false;
    online = true;
    byokEnabled = false;
    byokProvider = null;
  };

  const runRoute = () => {
    const ctx: RouteContext = {
      deviceAiCapable,
      byok: { enabled: byokEnabled, provider: byokProvider },
      online,
    };
    order = routeEngines(ctx);
  };

  test('BYOK off, device AI capable — foundation then heuristic', ({ given, and, when, then }) => {
    scenarioSetup();
    given(/^deviceAiCapable is true$/, () => { deviceAiCapable = true; });
    and(/^BYOK is off$/, () => { byokEnabled = false; byokProvider = null; });
    and(/^the device is online$/, () => { online = true; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK off, device AI not capable — heuristic only', ({ given, and, when, then }) => {
    scenarioSetup();
    given(/^deviceAiCapable is false$/, () => { deviceAiCapable = false; });
    and(/^BYOK is off$/, () => { byokEnabled = false; byokProvider = null; });
    and(/^the device is online$/, () => { online = true; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK on with openai and online — provider runs first', ({ given, and, when, then }) => {
    scenarioSetup();
    given(/^deviceAiCapable is true$/, () => { deviceAiCapable = true; });
    and(/^BYOK is on with provider "(.*)"$/, (provider: string) => {
      byokEnabled = true;
      byokProvider = provider as ByokProvider;
    });
    and(/^the device is online$/, () => { online = true; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK on with anthropic and online — provider runs first', ({ given, and, when, then }) => {
    scenarioSetup();
    given(/^deviceAiCapable is true$/, () => { deviceAiCapable = true; });
    and(/^BYOK is on with provider "(.*)"$/, (provider: string) => {
      byokEnabled = true;
      byokProvider = provider as ByokProvider;
    });
    and(/^the device is online$/, () => { online = true; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK on but offline — provider is dropped, falls to foundation/heuristic', ({
    given,
    and,
    when,
    then,
  }) => {
    scenarioSetup();
    given(/^deviceAiCapable is true$/, () => { deviceAiCapable = true; });
    and(/^BYOK is on with provider "(.*)"$/, (provider: string) => {
      byokEnabled = true;
      byokProvider = provider as ByokProvider;
    });
    and(/^the device is offline$/, () => { online = false; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK on but offline, no device AI — heuristic only', ({ given, and, when, then }) => {
    scenarioSetup();
    given(/^deviceAiCapable is false$/, () => { deviceAiCapable = false; });
    and(/^BYOK is on with provider "(.*)"$/, (provider: string) => {
      byokEnabled = true;
      byokProvider = provider as ByokProvider;
    });
    and(/^the device is offline$/, () => { online = false; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK on but no device AI, online — provider then heuristic', ({
    given,
    and,
    when,
    then,
  }) => {
    scenarioSetup();
    given(/^deviceAiCapable is false$/, () => { deviceAiCapable = false; });
    and(/^BYOK is on with provider "(.*)"$/, (provider: string) => {
      byokEnabled = true;
      byokProvider = provider as ByokProvider;
    });
    and(/^the device is online$/, () => { online = true; });
    when(/^I route engines$/, runRoute);
    then(/^the engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('BYOK config resolution — enabled with a saved key stays enabled', ({ given, when, then }) => {
    given(/^a BYOK config with enabled true and a saved key$/, () => {
      resolved = resolveByokEnabled(true, true);
    });
    when(/^I resolve the BYOK enabled flag$/, () => {
      // resolution already ran in `given` above — nothing more to do, but
      // keep the step present so the feature file reads naturally.
    });
    then(/^the resolved BYOK enabled flag should be true$/, () => {
      expect(resolved).toBe(true);
    });
  });

  test('BYOK config resolution — enabled but no key saved yet resolves to off', ({
    given,
    when,
    then,
  }) => {
    given(/^a BYOK config with enabled true and no saved key$/, () => {
      resolved = resolveByokEnabled(true, false);
    });
    when(/^I resolve the BYOK enabled flag$/, () => {});
    then(/^the resolved BYOK enabled flag should be false$/, () => {
      expect(resolved).toBe(false);
    });
  });

  test('BYOK config resolution — disabled stays disabled even with a saved key', ({
    given,
    when,
    then,
  }) => {
    given(/^a BYOK config with enabled false and a saved key$/, () => {
      resolved = resolveByokEnabled(false, true);
    });
    when(/^I resolve the BYOK enabled flag$/, () => {});
    then(/^the resolved BYOK enabled flag should be false$/, () => {
      expect(resolved).toBe(false);
    });
  });
});

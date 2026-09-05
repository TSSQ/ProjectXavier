import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(path.resolve(__dirname, '../__features__/glass-flag.feature'));

defineFeature(feature, (test) => {
  const originalEnv = process.env.EXPO_PUBLIC_GLASS;
  let flagEnabled: boolean;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EXPO_PUBLIC_GLASS;
    } else {
      process.env.EXPO_PUBLIC_GLASS = originalEnv;
    }
  });

  const scenarios: [string, string | undefined][] = [
    ['Unset defaults to enabled', undefined],
    ['"0" disables it', '0'],
    ['"1" enables it', '1'],
  ];

  for (const [name, value] of scenarios) {
    test(name, ({ given, when, then }) => {
      given(/^EXPO_PUBLIC_GLASS is (?:unset|"(.*)")$/, () => {
        if (value === undefined) {
          delete process.env.EXPO_PUBLIC_GLASS;
        } else {
          process.env.EXPO_PUBLIC_GLASS = value;
        }
      });

      when(/^I read GLASS_UI_ENABLED$/, () => {
        // Re-import under `jest.isolateModules` so the module re-evaluates
        // `GLASS_UI_ENABLED` against the env var just set above — a plain
        // top-level import would only ever see whatever was set the first
        // time this module was loaded in the process.
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const flags = require('../../src/lib/flags');
          flagEnabled = flags.GLASS_UI_ENABLED;
        });
      });

      then(/^GLASS_UI_ENABLED should be (true|false)$/, (expected: string) => {
        expect(flagEnabled).toBe(expected === 'true');
      });
    });
  }
});

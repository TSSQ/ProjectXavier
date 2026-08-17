import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  resolveGlassTier,
  glassTokensFor,
  darkGlass,
  lightGlass,
  GlassTier,
  GlassTokens,
  GlassRole,
} from '../../src/theme/glassTokens';

const feature = loadFeature(path.resolve(__dirname, '../__features__/glass-tokens.feature'));

const ROLES: GlassRole[] = ['chrome', 'card', 'clear', 'tinted'];

defineFeature(feature, (test) => {
  let tier: GlassTier;
  let tokens: GlassTokens;

  const whenResolveTier = (when: any) =>
    when(
      /^I resolve the glass tier with flag (on|off), glass (available|unavailable), api (available|unavailable), reduce transparency (on|off)$/,
      (flag: string, glass: string, api: string, rt: string) => {
        tier = resolveGlassTier({
          flagEnabled: flag === 'on',
          liquidGlassAvailable: glass === 'available',
          glassApiAvailable: api === 'available',
          reduceTransparency: rt === 'on',
        });
      }
    );

  const thenTier = (then: any) =>
    then(/^the glass tier should be "(.*)"$/, (expected: string) => {
      expect(tier).toBe(expected);
    });

  for (const name of [
    'Everything available and the flag on renders the native material',
    'The flag being off forces the opaque tier',
    'No Liquid Glass on the device forces the opaque tier',
    'A missing glass API forces the opaque tier',
    'Reduce Transparency forces the opaque tier even when glass is available',
  ]) {
    test(name, ({ when, then }) => {
      whenResolveTier(when);
      thenTier(then);
    });
  }

  test('Every role resolves in both themes', ({ when, then }) => {
    const read = (scheme: string) => {
      tokens = glassTokensFor(scheme as 'dark' | 'light');
    };
    const assertRoles = () => {
      for (const role of ROLES) {
        expect(['clear', 'regular']).toContain(tokens[role].systemStyle);
        expect(typeof tokens[role].fallback).toBe('string');
        expect(tokens[role].fallback.length).toBeGreaterThan(0);
      }
    };
    when(/^I read the glass tokens for "(.*)"$/, read);
    then(/^every glass role should carry a system style and an opaque fallback$/, assertRoles);
    when(/^I read the glass tokens for "(.*)"$/, read);
    then(/^every glass role should carry a system style and an opaque fallback$/, assertRoles);
  });

  test('Roles map to the system materials the proposal specifies', ({ when, then, and }) => {
    when(/^I read the glass tokens for "(.*)"$/, (scheme: string) => {
      tokens = glassTokensFor(scheme as 'dark' | 'light');
    });
    then(
      /^the "(.*)" role should use the "(.*)" system style$/,
      (role: string, style: string) => {
        expect(tokens[role as GlassRole].systemStyle).toBe(style);
      }
    );
    and(/^the "(.*)" role should use the "(.*)" system style$/, (role: string, style: string) => {
      expect(tokens[role as GlassRole].systemStyle).toBe(style);
    });
    and(/^the "(.*)" role should use the "(.*)" system style$/, (role: string, style: string) => {
      expect(tokens[role as GlassRole].systemStyle).toBe(style);
    });
    and(/^the "(.*)" role should carry a tint$/, (role: string) => {
      expect(tokens[role as GlassRole].tint).toBeTruthy();
    });
  });

  test('Light and dark carry different edge and specular values', ({ then, and }) => {
    then(/^the dark and light specular values should differ$/, () => {
      expect(darkGlass.card.specular).not.toBe(lightGlass.card.specular);
    });
    and(/^the dark and light edge values should differ$/, () => {
      expect(darkGlass.card.edge).not.toBe(lightGlass.card.edge);
    });
  });

  test('The depth field defines three wells in both themes', ({ when, then }) => {
    const read = (scheme: string) => {
      tokens = glassTokensFor(scheme as 'dark' | 'light');
    };
    const assertWells = (count: string) => {
      expect(tokens.field).toHaveLength(parseInt(count, 10));
      for (const well of tokens.field) expect(typeof well).toBe('string');
    };
    when(/^I read the glass tokens for "(.*)"$/, read);
    then(/^the depth field should define (\d+) wells$/, assertWells);
    when(/^I read the glass tokens for "(.*)"$/, read);
    then(/^the depth field should define (\d+) wells$/, assertWells);
  });
});

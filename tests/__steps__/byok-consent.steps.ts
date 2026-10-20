import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { byokActive, consentCopy, ByokConsentCopy } from '../../src/domain/byokConsent';
import { ByokProvider } from '../../src/domain/parseRouter';

const ROOT = path.resolve(__dirname, '../..');
const ENGINE_IMPORT = /from '[^']*(?:engines\/(?:openai|anthropic)|\/queryLoop)'/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Files under app/ and src/ that import a BYOK engine or the query loop. */
function importers(): string[] {
  return ['app', 'src']
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => ENGINE_IMPORT.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
}

const feature = loadFeature(path.resolve(__dirname, '../__features__/byok-consent.feature'));

defineFeature(feature, (test) => {
  test('byokActive needs both the toggle and consent', ({ when, then }) => {
    let result: boolean;
    when(
      /^BYOK enabled is (true|false) and consent for the provider is (true|false)$/,
      (enabled: string, consented: string) => {
        result = byokActive({
          enabled: enabled === 'true',
          provider: 'openai',
          consents: { openai: consented === 'true' },
        });
      },
    );
    then(/^BYOK should be active: (true|false)$/, (expected: string) => {
      expect(result).toBe(expected === 'true');
    });
  });

  test('The consent copy names the provider', ({ when, then, and }) => {
    let copy: ByokConsentCopy;
    when(/^I read the consent copy for "(.*)"$/, (p: string) => {
      copy = consentCopy(p as ByokProvider);
    });
    then(/^the title should be "(.*)"$/, (title: string) => {
      expect(copy.title).toBe(title);
    });
    and(/^the body should mention "(.*)" and "(.*)"$/, (name: string, phrase: string) => {
      expect(copy.body).toContain(name);
      expect(copy.body).toContain(phrase);
      // The disclosure must keep naming everything that is actually sent.
      for (const word of ['account', 'payee', 'transactions']) expect(copy.body).toContain(word);
    });
    and(/^the buttons should be "(.*)" and "(.*)"$/, (allow: string, cancel: string) => {
      expect(copy.allow).toBe(allow);
      expect(copy.cancel).toBe(cancel);
    });
  });

  test('Consent is per provider', ({ given, then, and }) => {
    let consented: ByokProvider;
    const active = (p: ByokProvider) =>
      byokActive({ enabled: true, provider: p, consents: { [consented]: true } });
    given(/^the user has consented for "(.*)" only$/, (p: string) => {
      consented = p as ByokProvider;
    });
    then(/^BYOK should be active for "(.*)" when enabled$/, (p: string) => {
      expect(active(p as ByokProvider)).toBe(true);
    });
    and(/^BYOK should not be active for "(.*)" when enabled$/, (p: string) => {
      expect(active(p as ByokProvider)).toBe(false);
    });
  });

  test('Another provider consent never activates the current provider', ({ then }) => {
    then('openai consent with provider anthropic should not be active', () => {
      expect(
        byokActive({ enabled: true, provider: 'anthropic', consents: { openai: true } }),
      ).toBe(false);
    });
  });

  test('Only allowlisted files can reach a BYOK engine', ({ then }) => {
    then('the files importing the BYOK engines or query loop should be the allowlist', () => {
      expect(importers().sort()).toEqual(
        [
          'app/(tabs)/index.tsx',
          'app/debug-byok.tsx',
          'src/features/ai/testKey.ts',
        ].sort(),
      );
    });
  });

  test('Provider endpoints appear only in allowlisted files', ({ then }) => {
    then('the files containing provider API hosts should be the allowlist', () => {
      const hosts = ['app', 'src']
        .flatMap((d) => walk(path.join(ROOT, d)))
        .filter((f) => /api\.(openai|anthropic)\.com/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
      expect(hosts.sort()).toEqual(
        [
          'app/debug-byok.tsx',
          'src/features/ai/engines/anthropic.ts',
          'src/features/ai/engines/openai.ts',
          'src/features/ai/listModels.ts',
          'src/features/ai/queryLoop.ts',
        ].sort(),
      );
    });
  });

  test('The parse path gates the BYOK engine on consent', ({ then }) => {
    then(/^the parse path source should reference byokActive and getByokConsent$/, () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
      expect(src).toContain('getByokConsent(');
      expect(src).toMatch(/const byokEnabledConfig = byokActive\(/);
      expect(src).toMatch(/byok:\s*\{\s*enabled:\s*resolveByokEnabled\(byokEnabledConfig,/);
    });
  });
});

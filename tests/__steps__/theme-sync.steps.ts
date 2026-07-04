import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { darkColors, lightColors } from '../../src/theme/tokens';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/theme-sync.feature')
);

const globalCss = fs.readFileSync(
  path.resolve(__dirname, '../../global.css'),
  'utf-8'
);

/** Parse `--color-<key>: <value>;` declarations out of a CSS block body. */
function parseColorVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--color-([A-Za-z0-9]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

function extractBlock(css: string, selectorRe: RegExp): string {
  const match = selectorRe.exec(css);
  if (!match) {
    throw new Error(`Could not find block for ${selectorRe} in global.css`);
  }
  return match[1]!;
}

defineFeature(feature, (test) => {
  test('Every dark token has a matching --color-* var in .dark:root', ({
    given,
    and,
    then,
  }) => {
    let darkVars: Record<string, string> = {};

    given('the dark theme palette', () => {
      // darkColors is imported directly.
    });
    and('the parsed .dark:root block from global.css', () => {
      const block = extractBlock(globalCss, /\.dark:root\s*\{([^}]*)\}/);
      darkVars = parseColorVars(block);
    });
    then('every dark token key should have an equal value in .dark:root', () => {
      for (const [key, value] of Object.entries(darkColors)) {
        expect(darkVars[key]?.toLowerCase()).toEqual(value.toLowerCase());
      }
    });
  });

  test('Every light token has a matching --color-* var in :root', ({
    given,
    and,
    then,
  }) => {
    let lightVars: Record<string, string> = {};

    given('the light theme palette', () => {
      // lightColors is imported directly.
    });
    and('the parsed :root block from global.css', () => {
      const block = extractBlock(globalCss, /(?<!dark):root\s*\{([^}]*)\}/);
      lightVars = parseColorVars(block);
    });
    then('every light token key should have an equal value in :root', () => {
      for (const [key, value] of Object.entries(lightColors)) {
        expect(lightVars[key]?.toLowerCase()).toEqual(value.toLowerCase());
      }
    });
  });

  test('global.css declares no orphaned --color-* vars', ({
    given,
    and,
    then,
  }) => {
    let lightVars: Record<string, string> = {};
    let darkVars: Record<string, string> = {};

    given('the dark theme palette', () => {
      // darkColors is imported directly.
    });
    and('the parsed :root block from global.css', () => {
      const block = extractBlock(globalCss, /(?<!dark):root\s*\{([^}]*)\}/);
      lightVars = parseColorVars(block);
    });
    and('the parsed .dark:root block from global.css', () => {
      const block = extractBlock(globalCss, /\.dark:root\s*\{([^}]*)\}/);
      darkVars = parseColorVars(block);
    });
    then('every --color-* var should correspond to a tokens.ts key', () => {
      const tokenKeys = new Set(Object.keys(darkColors));
      for (const key of Object.keys(lightVars)) {
        expect(tokenKeys.has(key)).toBe(true);
      }
      for (const key of Object.keys(darkVars)) {
        expect(tokenKeys.has(key)).toBe(true);
      }
    });
  });
});

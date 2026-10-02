import path from 'path';
import { execFileSync } from 'child_process';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { transform } from 'lightningcss';

const feature = loadFeature(path.resolve(__dirname, '../__features__/tailwind-css-compiles.feature'));
const ROOT = path.resolve(__dirname, '../..');

defineFeature(feature, (test) => {
  test('The generated stylesheet parses', ({ when, then }) => {
    let css = '';
    when('Tailwind builds the stylesheet from global.css', () => {
      css = execFileSync(
        path.join(ROOT, 'node_modules/.bin/tailwindcss'),
        ['-i', path.join(ROOT, 'global.css')],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    });
    then('lightningcss parses it without error', () => {
      expect(css.length).toBeGreaterThan(0);
      expect(() => transform({ filename: 'global.css', code: Buffer.from(css) })).not.toThrow();
    });
  }, 60000);
});

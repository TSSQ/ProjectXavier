import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'radius-scale.feature')
);

const ROOT = path.join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

defineFeature(feature, (test) => {
  let files: string[];

  const givenFiles = (given: any) =>
    given('every tsx file under app and src', () => {
      files = [
        ...tsxFiles(path.join(ROOT, 'app')),
        ...tsxFiles(path.join(ROOT, 'src')),
      ];
    });

  test('No component uses a radius outside the token scale', ({ given, then }) => {
    givenFiles(given);
    then(/^none should use a rounded- class outside "(.*)"$/, (allowedCsv: string) => {
      const allowed = new Set(allowedCsv.split(',').map((s) => s.trim()));
      const offenders: string[] = [];
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        // Only inside className strings — the word "rounded" appears in prose.
        for (const m of src.matchAll(/className=[{`"'][^`"'}]*/g)) {
          for (const cls of m[0].matchAll(/\brounded(?:-t|-b|-l|-r)?-([a-z0-9[\]]+)/g)) {
            if (!allowed.has(cls[1]!)) {
              offenders.push(`${path.relative(ROOT, f)}: rounded-${cls[1]}`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  test('No component uses an arbitrary pixel radius', ({ given, then }) => {
    givenFiles(given);
    then('none should use a rounded-[Npx] class', () => {
      const offenders = files
        .filter((f) => /rounded(?:-[tblr])?-\[\d+px\]/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  });
});

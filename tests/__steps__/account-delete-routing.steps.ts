import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-delete-routing.feature'));

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Every `.ts`/`.tsx` file under `app/` and `src/`, excluding `node_modules`
 *  and this suite itself — a plain recursive walk, no extra dependency. */
function allSourceFiles(): string[] {
  const roots = ['app', 'src'];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(path.join(REPO_ROOT, root));
  return out;
}

defineFeature(feature, (test) => {
  test('The chat assistant screen never imports or calls deleteAccountCascade', ({ then }) => {
    then(/^the assistant screen source should not reference "(.*)"$/, (symbol: string) => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'app/(tabs)/index.tsx'), 'utf8');
      expect(source).not.toContain(symbol);
    });
  });

  test('deleteAccountCascade is only ever imported by the manage-accounts screen', ({ then }) => {
    then(/^only "(.*)" should import deleteAccountCascade from the accounts repository$/, (allowed: string) => {
      // Matches an actual `import { ..., deleteAccountCascade, ... } from
      // '.../accounts/repository'` statement — not a mere textual mention
      // (comments, or `runAccountDeleteCascade`/`AccountDeleteImpact` in
      // sibling domain files) — so this can't false-positive on prose.
      const importRe = /import\s*\{[^}]*\bdeleteAccountCascade\b[^}]*\}\s*from\s*['"][^'"]*accounts\/repository['"]/;
      const importingFiles = allSourceFiles().filter((file) => {
        if (file.endsWith(path.join('src', 'features', 'accounts', 'repository.ts'))) return false;
        const source = fs.readFileSync(file, 'utf8');
        return importRe.test(source);
      });
      const relative = importingFiles.map((f) => path.relative(REPO_ROOT, f));
      expect(relative).toEqual([allowed]);
    });
  });
});

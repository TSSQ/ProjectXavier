import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/apple-binding-patch-applied.feature')
);

const BINDING_PATH = path.resolve(
  __dirname,
  '../../node_modules/@react-native-ai/apple/ios/AppleLLMImpl.swift'
);

const UNPATCHED_MESSAGE_HINT = 'run `npm install` to apply patches/';

/** Asserts `source` (the installed binding's AppleLLMImpl.swift, or a stand-
 *  in for a test) carries step 1a.5's patch: the `orderedPropertyNames`
 *  helper patch-package adds, and its read of the `"x-order"` schema key.
 *  Throws a clear, actionable error — naming the exact fix (`npm install`
 *  applies `patches/`) — rather than a bare assertion failure, so a stale/
 *  unpatched install fails loudly instead of silently shipping alphabetical
 *  field order (review S3). */
function assertApplePatchApplied(source: string): void {
  const missing: string[] = [];
  if (!source.includes('orderedPropertyNames')) missing.push('the "orderedPropertyNames" function');
  if (!source.includes('"x-order"')) missing.push('the "x-order" schema-key read');
  if (missing.length > 0) {
    throw new Error(
      `node_modules/@react-native-ai/apple/ios/AppleLLMImpl.swift is missing ${missing.join(' and ')} ` +
        `— the step 1a.5 deterministic-field-order patch isn't applied. ${UNPATCHED_MESSAGE_HINT} and try again.`
    );
  }
}

defineFeature(feature, (test) => {
  test(
    'The installed binding\'s source still contains the patch\'s deterministic-order function and its "x-order" read',
    ({ when, then, and }) => {
      let source: string;

      when('I read the installed @react-native-ai/apple binding\'s AppleLLMImpl.swift', () => {
        if (!fs.existsSync(BINDING_PATH)) {
          throw new Error(
            `${path.relative(process.cwd(), BINDING_PATH)} does not exist — ${UNPATCHED_MESSAGE_HINT} first.`
          );
        }
        source = fs.readFileSync(BINDING_PATH, 'utf8');
      });
      then('it should still define the orderedPropertyNames function', () => {
        expect(() => assertApplePatchApplied(source)).not.toThrow();
        expect(source).toContain('orderedPropertyNames');
      });
      and('it should still read the "x-order" key from the schema dictionary', () => {
        expect(source).toContain('"x-order"');
      });
      and('a missing patch should fail with a message telling me to run npm install to apply patches/', () => {
        // Proves the guard itself (not just this one real file) fails loudly
        // and actionably on a stale/unpatched source — without mutating the
        // real node_modules install to do it.
        const unpatchedSource = source
          .replace(/orderedPropertyNames/g, 'REMOVED')
          .replace(/"x-order"/g, 'REMOVED');
        expect(() => assertApplePatchApplied(unpatchedSource)).toThrow(/npm install.*apply patches\//);
      });
    }
  );
});

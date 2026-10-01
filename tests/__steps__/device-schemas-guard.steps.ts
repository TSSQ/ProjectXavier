import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import * as deviceSchemas from '../../src/domain/deviceSchemas';

const feature = loadFeature(path.resolve(__dirname, '../__features__/device-schemas-guard.feature'));

const DEVICE_PARSE_PATH = path.resolve(__dirname, '../../src/features/ai/deviceParse.ts');

/** The zod schema identifiers every on-device call used to be able to pass
 *  straight to `generateObject` before step 1a.5/review B1 pinned each to
 *  its own `src/domain/deviceSchemas.ts` export. Reverting any single call
 *  site back to one of these (QA's actual regression) must fail this guard. */
const ZOD_SCHEMA_IDENTIFIERS = [
  'deviceParseSchema',
  'accountParseSchema',
  'accountUpdateParseSchema',
  'queryToolSelectionSchema',
  'transactionOpSelectionSchema',
];

/** Every `schema:` argument found inside a `generateObject({...})` call in
 *  `deviceParse.ts`'s source text, in source order. A lightweight text scan
 *  (not a real parser) is deliberately enough here: none of the `system`/
 *  `prompt` arguments in these calls are object literals, so the FIRST `}`
 *  after `generateObject({` is always that call's own closing brace. */
function extractGenerateObjectSchemaArgs(source: string): string[] {
  const args: string[] = [];
  const callRegex = /generateObject\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source))) {
    const start = match.index + match[0].length;
    const end = source.indexOf('});', start);
    if (end === -1) {
      throw new Error('found "generateObject({" with no matching "});" in deviceParse.ts');
    }
    const body = source.slice(start, end);
    const schemaMatch = body.match(/schema:\s*([A-Za-z0-9_$.]+)\s*,?/);
    const schemaArg = schemaMatch?.[1];
    if (!schemaArg) {
      throw new Error(`generateObject call with no "schema:" property found at offset ${start}`);
    }
    args.push(schemaArg);
  }
  return args;
}

defineFeature(feature, (test) => {
  test('Every generateObject call in deviceParse.ts is schema-guarded', ({ given, when, then, and }) => {
    let source: string;
    let schemaArgs: string[];

    given('the source text of src/features/ai/deviceParse.ts', () => {
      source = fs.readFileSync(DEVICE_PARSE_PATH, 'utf8');
    });
    when('every generateObject call\'s "schema:" argument is extracted', () => {
      schemaArgs = extractGenerateObjectSchemaArgs(source);
    });
    then('there are exactly 5 generateObject calls', () => {
      expect(schemaArgs.length).toBe(5);
    });
    and('every "schema:" argument is one of src/domain/deviceSchemas\'s named exports', () => {
      const allowedExportNames = new Set(Object.keys(deviceSchemas));
      for (const arg of schemaArgs) {
        expect(allowedExportNames.has(arg)).toBe(true);
      }
    });
    and('no "schema:" argument is a bare zod schema identifier', () => {
      for (const arg of schemaArgs) {
        expect(ZOD_SCHEMA_IDENTIFIERS).not.toContain(arg);
      }
    });
  });
});

import fs from 'fs';
import path from 'path';
import { Schema } from 'ai';
import { defineFeature, loadFeature } from 'jest-cucumber';
import * as deviceSchemas from '../../src/domain/deviceSchemas';
import { declarationOrder } from '../../src/domain/orderedJsonSchema';
import { accountParseSchema } from '../../src/domain/accountParseSchema';
import { accountUpdateParseSchema } from '../../src/domain/accountUpdateSchema';
import { queryToolSelectionSchema } from '../../src/domain/queryToolSelection';
import { transactionOpSelectionSchema } from '../../src/domain/transactionOpSelection';

const feature = loadFeature(path.resolve(__dirname, '../__features__/device-schemas-guard.feature'));

const DEVICE_PARSE_PATH = path.resolve(__dirname, '../../src/features/ai/deviceParse.ts');

/** A `generateObject({ ... })` call formatted with the opening `{` on its own
 *  line (`generateObject(\n  {`), as QA's un-caught regression used. */
const SPLIT_BRACE_FIXTURE = `
  const { object } = await generateObject(
    {
      model: apple(),
      schema: deviceParseSchema,
    }
  );
`;

/** The zod schema identifiers every on-device call used to be able to pass
 *  straight to `generateObject` before step 1a.5/review B1 pinned each to
 *  its own `src/domain/deviceSchemas.ts` export. Reverting any single call
 *  site back to one of these (QA's actual regression) must fail this guard. */
const ZOD_SCHEMA_IDENTIFIERS = [
  'deviceParseSchema',
  'deviceParseFmSchema',
  'accountParseSchema',
  'accountUpdateParseSchema',
  'queryToolSelectionSchema',
  'transactionOpSelectionSchema',
];

/** Every `schema:` argument found inside a `generateObject({...})` call in
 *  `deviceParse.ts`'s source text, in source order. A lightweight text scan
 *  (not a real parser) is deliberately enough here: none of the `system`/
 *  `prompt` arguments in these calls are object literals, so balanced-brace
 *  counting from the object literal's OWN opening `{` always lands on that
 *  call's own closing `}` (not some earlier unrelated `}`). Matches the
 *  opening brace across whitespace/newlines (`generateObject(\n  {`), not
 *  just `generateObject({` on one line. */
function extractGenerateObjectSchemaArgs(source: string): string[] {
  const args: string[] = [];
  const callRegex = /generateObject\s*\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
    }
    if (depth !== 0) {
      throw new Error('found "generateObject(" with no matching closing "}" in deviceParse.ts');
    }
    const end = i - 1;
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

const NON_EXPENSE_EXPORTS: Record<string, Schema<unknown>> = {
  ACCOUNT_CREATE_SCHEMA: deviceSchemas.ACCOUNT_CREATE_SCHEMA,
  ACCOUNT_UPDATE_SCHEMA: deviceSchemas.ACCOUNT_UPDATE_SCHEMA,
  QUERY_TOOL_SELECTION_SCHEMA: deviceSchemas.QUERY_TOOL_SELECTION_SCHEMA,
  TRANSACTION_OP_SELECTION_SCHEMA: deviceSchemas.TRANSACTION_OP_SELECTION_SCHEMA,
};

const ZOD_SCHEMAS_BY_NAME: Record<string, Parameters<typeof declarationOrder>[0]> = {
  accountParseSchema,
  accountUpdateParseSchema,
  queryToolSelectionSchema,
  transactionOpSelectionSchema,
};

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
    and(
      'the "schema:" arguments equal, in source order, DEVICE_PARSE_SCHEMA, ACCOUNT_CREATE_SCHEMA, ACCOUNT_UPDATE_SCHEMA, QUERY_TOOL_SELECTION_SCHEMA, TRANSACTION_OP_SELECTION_SCHEMA',
      () => {
        expect(schemaArgs).toEqual([
          'DEVICE_PARSE_SCHEMA',
          'ACCOUNT_CREATE_SCHEMA',
          'ACCOUNT_UPDATE_SCHEMA',
          'QUERY_TOOL_SELECTION_SCHEMA',
          'TRANSACTION_OP_SELECTION_SCHEMA',
        ]);
      }
    );
  });

  test('The extractor itself catches a generateObject call whose opening brace is on its own line', ({
    given,
    when,
    then,
    and,
  }) => {
    let fixtureArgs: string[];

    given('an inline fixture containing a generateObject call split across lines with a bare zod schema', () => {
      // SPLIT_BRACE_FIXTURE declared above the test block.
    });
    when('every generateObject call\'s "schema:" argument is extracted from the fixture', () => {
      fixtureArgs = extractGenerateObjectSchemaArgs(SPLIT_BRACE_FIXTURE);
    });
    then('the extractor finds exactly 1 generateObject call in the fixture', () => {
      expect(fixtureArgs.length).toBe(1);
    });
    and('its "schema:" argument is a bare zod schema identifier, which the main guard would reject', () => {
      expect(ZOD_SCHEMA_IDENTIFIERS).toContain(fixtureArgs[0]);
    });
  });

  test("A non-expense deviceSchemas export is pinned to its own zod schema's declaration order", ({
    given,
    then,
    and,
  }) => {
    let exportName: string;
    let zodSchemaName: string;

    given(/^the deviceSchemas export "(.*)" and its zod schema "(.*)"$/, (exportArg: string, zodArg: string) => {
      exportName = exportArg;
      zodSchemaName = zodArg;
    });
    then(/^"(.*)"'s jsonSchema "x-order" deep-equals the declaration order of "(.*)"$/, () => {
      const exported = NON_EXPENSE_EXPORTS[exportName]!;
      const zodSchema = ZOD_SCHEMAS_BY_NAME[zodSchemaName]!;
      const jsonSchema = exported.jsonSchema as Record<string, unknown>;
      expect(jsonSchema['x-order']).toEqual(declarationOrder(zodSchema));
    });
    and(/^"(.*)"'s validate is a function$/, () => {
      const exported = NON_EXPENSE_EXPORTS[exportName]!;
      expect(typeof exported.validate).toBe('function');
    });
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  extractAnthropicToolInput,
  extractOpenAiJsonContent,
  classifyTestKeyStatus,
  isRecord,
  TestKeyResult,
} from '../../src/domain/cloudParseTransport';
import { DEVICE_PARSE_JSON_SCHEMA } from '../../src/domain/cloudParseSchema';
import { deviceParseSchema } from '../../src/domain/deviceParsePrompt';
import { runCloudParse, EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';

const feature = loadFeature(path.resolve(__dirname, '../__features__/cloud-parse-transport.feature'));

type DeviceParseRow = {
  amount: string;
  type: string;
  category: string;
  payee: string;
  account: string;
  confidence: string;
  pending: string;
};

/** Convert a feature-table row into the shape `deviceParseSchema` expects —
 *  a plain object mirroring what a real tool_use `input` / json_schema
 *  `content` payload would carry. */
function parseDeviceParseRow(row: DeviceParseRow): Record<string, unknown> {
  return {
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    payee: row.payee,
    account: row.account,
    confidence: Number(row.confidence),
    pending: row.pending === 'true',
  };
}

type AnthropicMalformedKind =
  | 'text-only-no-tool-use'
  | 'non-object-response'
  | 'content-not-an-array'
  | 'tool-use-block-missing-input'
  | 'tool-use-input-is-a-string'
  | 'tool-use-input-is-a-number'
  | 'tool-use-input-is-an-array';

function anthropicToolUseResponse(input: Record<string, unknown>): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    content: [
      { type: 'text', text: 'Sure, recording that now.' },
      { type: 'tool_use', id: 'toolu_1', name: 'record_expense', input },
    ],
  };
}

function anthropicMalformedResponse(kind: AnthropicMalformedKind): unknown {
  switch (kind) {
    case 'text-only-no-tool-use':
      return { id: 'msg_1', content: [{ type: 'text', text: 'I cannot do that.' }] };
    case 'non-object-response':
      return 'not an object';
    case 'content-not-an-array':
      return { id: 'msg_1', content: 'not-an-array' };
    case 'tool-use-block-missing-input':
      return { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_expense' }] };
    case 'tool-use-input-is-a-string':
      return {
        id: 'msg_1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_expense', input: 'oops' }],
      };
    case 'tool-use-input-is-a-number':
      return {
        id: 'msg_1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_expense', input: 42 }],
      };
    case 'tool-use-input-is-an-array':
      return {
        id: 'msg_1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_expense', input: [1, 2, 3] }],
      };
  }
}

type OpenAiMalformedKind =
  | 'content-not-valid-json'
  | 'non-object-response'
  | 'choices-not-an-array'
  | 'empty-choices'
  | 'content-not-a-string'
  | 'content-is-a-number'
  | 'content-is-an-array';

function openAiJsonContentResponse(input: Record<string, unknown>): unknown {
  return {
    id: 'chatcmpl_1',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(input) } }],
  };
}

function openAiMalformedResponse(kind: OpenAiMalformedKind): unknown {
  switch (kind) {
    case 'content-not-valid-json':
      return { choices: [{ message: { content: '{not valid json' } }] };
    case 'non-object-response':
      return 42;
    case 'choices-not-an-array':
      return { choices: 'not-an-array' };
    case 'empty-choices':
      return { choices: [] };
    case 'content-not-a-string':
      return { choices: [{ message: { content: { amount: 5 } } }] };
    case 'content-is-a-number':
      return { choices: [{ message: { content: '42' } }] };
    case 'content-is-an-array':
      return { choices: [{ message: { content: '[1,2,3]' } }] };
  }
}

type RawObjectKind = 'array' | 'string' | 'number' | 'record' | 'null';

function rawObjectOfKind(kind: RawObjectKind): unknown {
  switch (kind) {
    case 'array':
      return [1, 2, 3];
    case 'string':
      return 'not an object';
    case 'number':
      return 42;
    case 'record':
      return { amount: 5 };
    case 'null':
      return null;
  }
}

defineFeature(feature, (test) => {
  test("Anthropic's forced tool_use block yields the raw device-parse object", ({
    given,
    when,
    then,
  }) => {
    let toolInput: Record<string, unknown>;
    let response: unknown;
    let extracted: unknown;

    given(/^an Anthropic response with a tool_use block containing:$/, (table: DeviceParseRow[]) => {
      toolInput = parseDeviceParseRow(table[0]!);
      response = anthropicToolUseResponse(toolInput);
    });

    when('I extract the Anthropic tool input', () => {
      extracted = extractAnthropicToolInput(response);
    });

    then('the extracted object should equal the tool_use input', () => {
      expect(extracted).toEqual(toolInput);
    });
  });

  test('Anthropic responses with no usable tool_use resolve to null', ({ given, when, then }) => {
    let response: unknown;
    let extracted: unknown;

    given(/^an Anthropic response of kind "(.*)"$/, (kind: string) => {
      response = anthropicMalformedResponse(kind as AnthropicMalformedKind);
    });

    when('I extract the Anthropic tool input', () => {
      extracted = extractAnthropicToolInput(response);
    });

    then('the extracted object should be null', () => {
      expect(extracted).toBeNull();
    });
  });

  test("OpenAI's json_schema content yields the raw device-parse object", ({
    given,
    when,
    then,
  }) => {
    let toolInput: Record<string, unknown>;
    let response: unknown;
    let extracted: unknown;

    given(/^an OpenAI response with json_schema content containing:$/, (table: DeviceParseRow[]) => {
      toolInput = parseDeviceParseRow(table[0]!);
      response = openAiJsonContentResponse(toolInput);
    });

    when('I extract the OpenAI json content', () => {
      extracted = extractOpenAiJsonContent(response);
    });

    then('the extracted object should equal the tool_use input', () => {
      expect(extracted).toEqual(toolInput);
    });
  });

  test('OpenAI responses with no usable content resolve to null', ({ given, when, then }) => {
    let response: unknown;
    let extracted: unknown;

    given(/^an OpenAI response of kind "(.*)"$/, (kind: string) => {
      response = openAiMalformedResponse(kind as OpenAiMalformedKind);
    });

    when('I extract the OpenAI json content', () => {
      extracted = extractOpenAiJsonContent(response);
    });

    then('the extracted object should be null', () => {
      expect(extracted).toBeNull();
    });
  });

  test('DEVICE_PARSE_JSON_SCHEMA stays in sync with deviceParseSchema', ({ when, then, and }) => {
    when('I compare DEVICE_PARSE_JSON_SCHEMA against deviceParseSchema', () => {
      // no-op: both sides are already imported module-level constants.
    });

    then("the JSON schema property keys should match deviceParseSchema's fields", () => {
      const properties = DEVICE_PARSE_JSON_SCHEMA.properties as Record<string, unknown>;
      expect(Object.keys(properties).sort()).toEqual(Object.keys(deviceParseSchema.shape).sort());
    });

    and(/^the JSON schema "(.*)" enum should be expense, income, transfer$/, (fieldName: string) => {
      const properties = DEVICE_PARSE_JSON_SCHEMA.properties as Record<string, { enum?: string[] }>;
      const shape = deviceParseSchema.shape as Record<string, { options?: string[] }>;
      expect(properties[fieldName]?.enum).toEqual(shape[fieldName]?.options);
      expect(properties[fieldName]?.enum).toEqual(['expense', 'income', 'transfer']);
    });

    and("the JSON schema required fields should match deviceParseSchema's required fields", () => {
      // Independently derived from zod's own per-field introspection (not
      // via the same zodSchema() conversion the constant itself uses) so
      // this is a genuine cross-check, not a tautology.
      const expectedRequired = Object.entries(deviceParseSchema.shape)
        .filter(([, field]) => !(field as { isOptional(): boolean }).isOptional())
        .map(([name]) => name);
      expect([...(DEVICE_PARSE_JSON_SCHEMA.required as string[])].sort()).toEqual(
        expectedRequired.sort()
      );
    });
  });

  test('A non-record raw object never reaches normalization', ({ given, when, then }) => {
    let fetchRawObject: (signal: AbortSignal) => Promise<unknown>;
    let result: unknown;

    given(/^a fetchRawObject stub that resolves to a raw value of kind "(.*)"$/, (kind: string) => {
      const raw = rawObjectOfKind(kind as RawObjectKind);
      fetchRawObject = async () => raw;
    });

    when(/^I run the cloud parse pipeline against text "(.*)"$/, async (text: string) => {
      // normalize is now a REQUIRED argument (reviewer follow-up — see
      // src/features/ai/engines/shared.ts's runCloudParse header for why the
      // old generic default was unsound); this path never reaches it anyway
      // (isRecord fails first), so which contract's normalize is passed
      // doesn't affect the assertion below.
      result = await runCloudParse(
        fetchRawObject,
        text,
        { categories: [], payees: [], accounts: [], now: Date.UTC(2026, 0, 1) },
        'test-engine',
        EXPENSE_PARSE_CONTRACT.normalize
      );
    });

    then('the cloud parse result should be null', () => {
      expect(result).toBeNull();
    });
  });

  test('testKey status classification uses the real HTTP status', ({ given, when, then }) => {
    let status: number;
    let usableBody: boolean;
    let result: TestKeyResult;

    given(/^a test-key response with status (\d+) and a usable body of (true|false)$/, (
      s: string,
      usable: string
    ) => {
      status = Number(s);
      usableBody = usable === 'true';
    });

    when('I classify the test-key status', () => {
      result = classifyTestKeyStatus(status, usableBody);
    });

    then(/^the classification should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected as TestKeyResult);
    });
  });

  test('The testKey "usable" gate matches the record gate runCloudParse uses', ({
    given,
    when,
    and,
    then,
  }) => {
    let raw: unknown;
    let usable: boolean;
    let result: TestKeyResult;

    given(/^a raw model object of kind "(.*)"$/, (kind: string) => {
      raw = rawObjectOfKind(kind as RawObjectKind);
    });

    when('I determine whether it is a usable record', () => {
      // The EXACT gate runCloudParse uses (src/features/ai/engines/shared.ts)
      // — proves testByokKey's "ok" classification can never diverge from
      // what the real parse would accept.
      usable = isRecord(raw);
    });

    and(/^I classify the test-key status 200 using that usable-record result$/, () => {
      result = classifyTestKeyStatus(200, usable);
    });

    then(/^the classification should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected as TestKeyResult);
    });
  });
});

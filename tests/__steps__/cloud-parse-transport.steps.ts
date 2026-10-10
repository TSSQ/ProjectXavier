import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  extractAnthropicToolInput,
  extractOpenAiJsonContent,
  classifyTestKeyStatus,
  classifyCloudParseStatus,
  cloudFallbackNotice,
  CloudParseFailure,
  isRecord,
  TestKeyResult,
} from '../../src/domain/cloudParseTransport';
import { ByokProvider } from '../../src/domain/parseRouter';
import { cloudFailureDetail, cloudFailureCounts, fmFallbackDetail, fmFallbackCounts } from '../../src/domain/parseMetrics';
import { cloudExpenseJsonSchemaFor } from '../../src/domain/cloudParseSchema';
import { fmParseSchemaFor } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { runCloudParse, CloudRawFetchResult, EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';

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

  test("The cloud JSON schema is the on-device FM schema for the text's amount plan", ({
    when,
    then,
    and,
  }) => {
    let schema: Record<string, unknown>;
    let zodShape: Record<string, unknown>;

    when(/^I build the cloud expense JSON schema for "(.*)"$/, (text: string) => {
      const plan = planFmAmount(text);
      schema = cloudExpenseJsonSchemaFor(plan);
      zodShape = fmParseSchemaFor(plan).shape;
    });

    then("the JSON schema property keys should match the FM schema's fields for that plan", () => {
      const properties = schema.properties as Record<string, unknown>;
      expect(Object.keys(properties).sort()).toEqual(Object.keys(zodShape).sort());
      // The log-or-refuse verdict is part of the wire contract.
      expect(Object.keys(properties)).toContain('isTransaction');
    });

    and(/^the JSON schema "(.*)" enum should be expense, income, transfer$/, (fieldName: string) => {
      const properties = schema.properties as Record<string, { enum?: string[] }>;
      const shape = zodShape as Record<string, { options?: string[] }>;
      expect(properties[fieldName]?.enum).toEqual(shape[fieldName]?.options);
      expect(properties[fieldName]?.enum).toEqual(['expense', 'income', 'transfer']);
    });

    and("the JSON schema required fields should match the FM schema's required fields", () => {
      // Independently derived from zod's own per-field introspection (not
      // via the same zodSchema() conversion the schema itself uses) so this
      // is a genuine cross-check, not a tautology.
      const expectedRequired = Object.entries(zodShape)
        .filter(([, field]) => !(field as { isOptional(): boolean }).isOptional())
        .map(([name]) => name);
      expect([...(schema.required as string[])].sort()).toEqual(expectedRequired.sort());
    });

    and(/^the JSON schema should carry no "x-order" key$/, () => {
      // The native binding's ordering hint is not standard JSON Schema; the
      // cloud providers get none of it.
      expect('x-order' in schema).toBe(false);
    });

    and(/^the JSON schema amount field should be "(.*)"$/, (expected: string) => {
      const properties = schema.properties as Record<string, { type?: string; enum?: string[] }>;
      if (expected === 'absent') {
        expect('amount' in properties).toBe(false);
      } else if (expected === 'number') {
        expect(properties.amount?.type).toBe('number');
        expect(properties.amount?.enum).toBeUndefined();
      } else {
        const labels = expected.replace(/^enum /, '').split(', ');
        expect(properties.amount?.enum).toEqual(labels);
      }
    });
  });

  test('A non-record raw object never reaches normalization', ({ given, when, then }) => {
    let fetchRawObject: (signal: AbortSignal) => Promise<CloudRawFetchResult>;
    let result: { ok: boolean; reason?: CloudParseFailure };

    given(/^a fetchRawObject stub that resolves to a raw value of kind "(.*)"$/, (kind: string) => {
      const raw = rawObjectOfKind(kind as RawObjectKind);
      // A 2xx whose body isn't a usable record — the status is fine, the
      // body is what fails.
      fetchRawObject = async () => ({ status: 200, raw });
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
        { categories: [], payees: [], accounts: [], now: Date.UTC(2026, 0, 1), currency: 'USD' },
        'test-engine',
        EXPENSE_PARSE_CONTRACT.normalize
      );
    });

    then(/^the cloud parse result should fail with reason "(.*)"$/, (reason: string) => {
      expect(result).toEqual({ ok: false, reason });
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
  test('A BYOK parse failure is classified by the real HTTP status, key-free', ({ when, then }) => {
    let reason: CloudParseFailure | null;

    when(/^I classify a cloud parse HTTP status of (\d+)$/, (status: string) => {
      reason = classifyCloudParseStatus(Number(status));
    });

    then(/^the cloud failure reason should be "(.*)"$/, (expected: string) => {
      expect(reason).toBe(expected === 'none' ? null : expected);
    });
  });

  test("The draft card says which key didn't answer, roughly why, and who took over", ({
    when,
    then,
  }) => {
    let notice: string;

    when(
      /^I build the cloud fallback notice for provider "(.*)" reason "(.*)" served by "(.*)"$/,
      (provider: string, reason: string, servedBy: string) => {
        notice = cloudFallbackNotice(
          provider as ByokProvider,
          reason as CloudParseFailure,
          servedBy as 'on_device' | 'heuristic'
        );
      }
    );

    then(/^the notice should be "(.*)"$/, (expected: string) => {
      expect(notice).toBe(expected);
    });
  });

  test("The BYOK failure reason is recorded content-free on the provider's metric row", ({
    when,
    then,
    and,
  }) => {
    let detail: string;
    const rows = [
      cloudFailureDetail('auth'),
      cloudFailureDetail('auth'),
      cloudFailureDetail('rate_limited'),
      fmFallbackDetail('threw'),
      null,
      'not json',
    ].map((groundingCounts) => ({ groundingCounts }));

    when(/^I build the cloud failure metric detail for reason "(.*)"$/, (reason: string) => {
      detail = cloudFailureDetail(reason as CloudParseFailure);
    });

    then(/^the detail should be the JSON (.*)$/, (expected: string) => {
      expect(detail).toBe(expected);
      // Content-free by construction: a fixed enum value and nothing else.
      expect(Object.keys(JSON.parse(detail))).toEqual(['cloudFailure']);
    });

    and(
      /^cloud failure counts over rows with details .* should be auth 2 and rate_limited 1$/,
      () => {
        expect(cloudFailureCounts(rows)).toEqual({ auth: 2, rate_limited: 1 });
      }
    );

    and('fmFallback counts over the same rows should ignore the cloud rows', () => {
      expect(fmFallbackCounts(rows)).toEqual({ threw: 1 });
    });
  });
});

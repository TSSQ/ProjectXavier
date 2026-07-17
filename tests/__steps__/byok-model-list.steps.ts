import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ModelChoice,
  normalizeAnthropicModels,
  normalizeOpenAiModels,
  normalizeModels,
  isKnownModel,
  shouldApplyModelsResult,
} from '../../src/domain/byokModels';
import { ByokProvider } from '../../src/domain/parseRouter';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/byok-model-list.feature')
);

type AnthropicRow = { id: string; display_name: string; structured_outputs_supported: string };
type OpenAiRow = { id: string; created: string };
type MalformedKind = 'not-an-object' | 'missing-data' | 'non-array-data' | 'non-string-id';

function buildAnthropicRaw(rows: AnthropicRow[]): unknown {
  return {
    data: rows.map((r) => {
      const item: Record<string, unknown> = { id: r.id, display_name: r.display_name };
      if (r.structured_outputs_supported !== 'absent') {
        item.capabilities = {
          structured_outputs: { supported: r.structured_outputs_supported === 'true' },
        };
      }
      return item;
    }),
  };
}

function buildOpenAiRaw(rows: OpenAiRow[]): unknown {
  return {
    object: 'list',
    data: rows.map((r) => ({ id: r.id, object: 'model', created: Number(r.created), owned_by: 'openai' })),
  };
}

function malformedRawPayload(kind: MalformedKind): unknown {
  switch (kind) {
    case 'not-an-object':
      return 'not an object';
    case 'missing-data':
      return {};
    case 'non-array-data':
      return { data: 'not-an-array' };
    case 'non-string-id':
      return { data: [{ id: 123 }] };
  }
}

/** A `data` array mixing non-object/garbage entries with one valid model —
 *  proves the per-item guard (`isRecord`) drops garbage without throwing. */
function anthropicRawWithGarbage(): unknown {
  return {
    data: [
      null,
      'x',
      42,
      {
        id: 'claude-haiku-4-5',
        display_name: 'Claude Haiku 4.5',
        capabilities: { structured_outputs: { supported: true } },
      },
    ],
  };
}

function openAiRawWithGarbage(): unknown {
  return {
    object: 'list',
    data: [null, 'x', 42, { id: 'gpt-4o', object: 'model', created: 100, owned_by: 'openai' }],
  };
}

defineFeature(feature, (test) => {
  test('Anthropic keeps models unless structured outputs is explicitly unsupported', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw Anthropic models:$/, (table: AnthropicRow[]) => {
      raw = buildAnthropicRaw(table);
    });

    when('I normalize the Anthropic models', () => {
      result = normalizeAnthropicModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('Anthropic label falls back to the id when display_name is missing', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw Anthropic models:$/, (table: AnthropicRow[]) => {
      raw = buildAnthropicRaw(table);
    });

    when('I normalize the Anthropic models', () => {
      result = normalizeAnthropicModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('OpenAI keeps chat models, drops non-chat modalities, and sorts newest first', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw OpenAI models:$/, (table: OpenAiRow[]) => {
      raw = buildOpenAiRaw(table);
    });

    when('I normalize the OpenAI models', () => {
      result = normalizeOpenAiModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('A malformed payload never throws and normalizes to no models', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let provider: ByokProvider;
    let result: ModelChoice[];

    given(/^a "(.*)" raw payload for "(.*)"$/, (kind: string, p: string) => {
      raw = malformedRawPayload(kind as MalformedKind);
      provider = p as ByokProvider;
    });

    when(/^I normalize the "(.*)" models$/, () => {
      result = normalizeModels(provider, raw);
    });

    then('the normalized models should be empty', () => {
      expect(result).toEqual([]);
    });
  });

  test("normalizeModels dispatches to Anthropic's normalizer", ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw Anthropic models:$/, (table: AnthropicRow[]) => {
      raw = buildAnthropicRaw(table);
    });

    when(/^I normalize via normalizeModels for provider "(.*)"$/, (provider: string) => {
      result = normalizeModels(provider as ByokProvider, raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test("normalizeModels dispatches to OpenAI's normalizer", ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw OpenAI models:$/, (table: OpenAiRow[]) => {
      raw = buildOpenAiRaw(table);
    });

    when(/^I normalize via normalizeModels for provider "(.*)"$/, (provider: string) => {
      result = normalizeModels(provider as ByokProvider, raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('isKnownModel reports whether an id is present in the fetched list', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw Anthropic models:$/, (table: AnthropicRow[]) => {
      raw = buildAnthropicRaw(table);
    });

    when('I normalize the Anthropic models', () => {
      result = normalizeAnthropicModels(raw);
    });

    then(/^"(.*)" should be a known model$/, (id: string) => {
      expect(isKnownModel(result, id)).toBe(true);
    });

    then(/^"(.*)" should not be a known model$/, (id: string) => {
      expect(isKnownModel(result, id)).toBe(false);
    });
  });

  test('Anthropic normalizer dedupes duplicate ids, keeping the first occurrence', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw Anthropic models:$/, (table: AnthropicRow[]) => {
      raw = buildAnthropicRaw(table);
    });

    when('I normalize the Anthropic models', () => {
      result = normalizeAnthropicModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('OpenAI normalizer dedupes duplicate ids, keeping the first occurrence', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given(/^raw OpenAI models:$/, (table: OpenAiRow[]) => {
      raw = buildOpenAiRaw(table);
    });

    when('I normalize the OpenAI models', () => {
      result = normalizeOpenAiModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('Anthropic normalizer skips garbage items mixed into the data array', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given('a raw Anthropic payload with garbage items mixed in', () => {
      raw = anthropicRawWithGarbage();
    });

    when('I normalize the Anthropic models', () => {
      result = normalizeAnthropicModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('OpenAI normalizer skips garbage items mixed into the data array', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: ModelChoice[];

    given('a raw OpenAI payload with garbage items mixed in', () => {
      raw = openAiRawWithGarbage();
    });

    when('I normalize the OpenAI models', () => {
      result = normalizeOpenAiModels(raw);
    });

    then(/^the normalized models should be:$/, (table: ModelChoice[]) => {
      expect(result).toEqual(table);
    });
  });

  test('shouldApplyModelsResult guards a stale fetch by token alone', ({
    given,
    when,
    then,
  }) => {
    let requestToken: number;
    let latestToken: number;
    let result: boolean;

    given(/^a models fetch requested with token (\d+)$/, (token: string) => {
      requestToken = Number(token);
    });

    given(/^the latest token is (\d+)$/, (token: string) => {
      latestToken = Number(token);
    });

    when('I check whether the models result should apply', () => {
      result = shouldApplyModelsResult({ requestToken, latestToken });
    });

    then(/^the result should apply should be (true|false)$/, (expected: string) => {
      expect(result).toBe(expected === 'true');
    });
  });
});

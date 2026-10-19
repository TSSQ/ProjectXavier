import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  openAiSupportsTemperature,
  anthropicSupportsTemperature,
  byokSamplingParams,
} from '../../src/domain/byokSampling';
import { ByokProvider } from '../../src/domain/parseRouter';
import {
  normalizeOpenAiModels,
  normalizeAnthropicModels,
  ModelChoice,
  DEFAULT_BYOK_MODEL,
} from '../../src/domain/byokModels';

const feature = loadFeature(path.resolve(__dirname, '../__features__/byok-sampling.feature'));

defineFeature(feature, (test) => {
  test("OpenAI — the non-reasoning GPT families accept temperature, reasoning models don't", ({
    when,
    then,
  }) => {
    let answer: boolean;
    when(/^I ask whether OpenAI model "(.*)" supports temperature$/, (model: string) => {
      answer = openAiSupportsTemperature(model);
    });
    then(/^the answer should be (true|false)$/, (expected: string) => {
      expect(answer).toBe(expected === 'true');
    });
  });

  test('Anthropic — Claude 4.6 and earlier accept temperature, 4.7+ reject it', ({ when, then }) => {
    let answer: boolean;
    when(/^I ask whether Anthropic model "(.*)" supports temperature$/, (model: string) => {
      answer = anthropicSupportsTemperature(model);
    });
    then(/^the answer should be (true|false)$/, (expected: string) => {
      expect(answer).toBe(expected === 'true');
    });
  });

  test('The request-body fragment is exactly temperature 0 or nothing', ({ when, then }) => {
    let fragment: Record<string, unknown>;
    when(
      /^I build the sampling params for provider "(.*)" and model "(.*)"$/,
      (provider: string, model: string) => {
        fragment = byokSamplingParams(provider as ByokProvider, model);
      }
    );
    then(/^the fragment should be (.*)$/, (expected: string) => {
      expect(fragment).toEqual(JSON.parse(expected));
    });
  });

  test("The default OpenAI model is still offered by the model picker's normalizer", ({
    given,
    when,
    then,
    and,
  }) => {
    let raw: unknown;
    let models: ModelChoice[];
    given('raw OpenAI models containing the default OpenAI model id', () => {
      raw = {
        data: [
          { id: 'gpt-4o-mini', created: 100 },
          { id: DEFAULT_BYOK_MODEL.openai, created: 200 },
          { id: 'text-embedding-3-small', created: 300 },
        ],
      };
    });
    when('I normalize those OpenAI models', () => {
      models = normalizeOpenAiModels(raw);
    });
    then('the default OpenAI model id should be listed', () => {
      expect(models.map((m) => m.id)).toContain(DEFAULT_BYOK_MODEL.openai);
    });
    and('the default OpenAI model should accept temperature', () => {
      expect(openAiSupportsTemperature(DEFAULT_BYOK_MODEL.openai)).toBe(true);
    });
  });
  test('The default Anthropic model is offered by the model picker and gets no temperature', ({
    given,
    when,
    then,
    and,
  }) => {
    let raw: unknown;
    let models: ModelChoice[];
    given('raw Anthropic models containing the default Anthropic model id', () => {
      raw = {
        data: [
          { id: DEFAULT_BYOK_MODEL.anthropic, display_name: 'Claude Haiku 5.5' },
          { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
        ],
      };
    });
    when('I normalize those Anthropic models', () => {
      models = normalizeAnthropicModels(raw);
    });
    then(/^the default Anthropic model id should be "(.*)"$/, (id: string) => {
      expect(DEFAULT_BYOK_MODEL.anthropic).toBe(id);
    });
    and('the default Anthropic model id should be listed', () => {
      expect(models.map((m) => m.id)).toContain(DEFAULT_BYOK_MODEL.anthropic);
    });
    and('the default Anthropic model should not accept temperature', () => {
      expect(anthropicSupportsTemperature(DEFAULT_BYOK_MODEL.anthropic)).toBe(false);
    });
    and('the Anthropic sampling fragment for the default model should be {}', () => {
      expect(byokSamplingParams('anthropic', DEFAULT_BYOK_MODEL.anthropic)).toEqual({});
    });
  });
});

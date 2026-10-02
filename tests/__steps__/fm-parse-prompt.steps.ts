import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, TransactionType } from '../../src/domain/types';
import {
  deviceParseSchema,
  deviceParseFmSchema,
  buildFmParseInstructions,
  buildFmParsePrompt,
} from '../../src/domain/deviceParsePrompt';
import { nextId } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-parse-prompt.feature'));

const fieldDescriptions = (): string[] =>
  Object.values(deviceParseFmSchema.shape).map((f) => (f as { description?: string }).description ?? '');

const requiredKeys = (shape: Record<string, { isOptional(): boolean }>): string[] =>
  Object.keys(shape).filter((k) => !shape[k]!.isOptional()).sort();

defineFeature(feature, (test) => {
  let instructions: string;
  let prompt: string;
  let categories: Category[] = [];
  let texts: string[] = [];
  let categoryDescription: string;

  beforeEach(() => {
    categories = [];
  });

  const buildPrompt = (when: any) =>
    when(/^I build the FM parse prompt for "(.*)" at time (\d+)$/, (text: string) => {
      prompt = buildFmParsePrompt(text, { categories, payees: [], accounts: [], now: 1735689600000 });
    });
  const mentionsInstructions = (then: any) =>
    then(/^the FM instructions should mention "(.*)"$/, (s: string) => expect(instructions).toContain(s));
  const mentionsPrompt = (step: any) =>
    step(/^the FM prompt should mention "(.*)"$/, (s: string) => expect(prompt).toContain(s));

  test('The FM instructions refuse questions, plans, budgets and debts even with an amount', ({
    when,
    then,
    and,
  }) => {
    when(/^I build the FM parse instructions$/, () => {
      instructions = buildFmParseInstructions();
    });
    mentionsInstructions(then);
    mentionsInstructions(and);
    mentionsInstructions(and);
    mentionsInstructions(and);
    mentionsInstructions(and);
  });

  test('The FM instructions and schema give no example amount to copy', ({ when, then }) => {
    when(/^I collect every FM instruction and schema description$/, () => {
      texts = [buildFmParseInstructions(), ...fieldDescriptions()];
    });
    // Only 0 (the refusal sentinel), 1 (confidence range) and the ISO 4217 name may appear.
    then(/^none of them should contain a digit from 2 to 9$/, () => {
      for (const t of texts) expect(t.replace('ISO 4217', '')).not.toMatch(/[2-9]/);
    });
  });

  test('The FM prompt lists the categories as one flat list and repeats the log or refuse rule', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^FM existing categories:$/, (table: Array<{ name: string; kind: string }>) => {
      categories = table.map((r) => ({ id: nextId('cat'), name: r.name, kind: r.kind as TransactionType }));
    });
    buildPrompt(when);
    mentionsPrompt(then);
    mentionsPrompt(and);
    and(/^the FM prompt should end with "(.*)"$/, (s: string) => expect(prompt.endsWith(s)).toBe(true));
  });

  test('The FM prompt has no category, payee or account hints when none exist', ({ when, then, and }) => {
    buildPrompt(when);
    const absent = (step: any) =>
      step(/^the FM prompt should not mention "(.*)"$/, (s: string) => expect(prompt).not.toContain(s));
    absent(then);
    absent(and);
    absent(and);
  });

  test('The FM schema asks for a category from the list or an empty string', ({ when, then, and }) => {
    when(/^I read the FM schema category description$/, () => {
      categoryDescription = deviceParseFmSchema.shape.category.description ?? '';
    });
    const mentions = (step: any) =>
      step(/^the FM category description should mention "(.*)"$/, (s: string) =>
        expect(categoryDescription).toContain(s.replace(/\\"/g, '"'))
      );
    mentions(then);
    mentions(and);
  });

  test('The FM schema has the same fields and required set as the shared schema', ({ when, then, and }) => {
    when(/^I compare the FM schema with the shared device parse schema$/, () => undefined);
    then(/^both schemas should have the same field names$/, () => {
      expect(Object.keys(deviceParseFmSchema.shape).sort()).toEqual(
        Object.keys(deviceParseSchema.shape).sort()
      );
    });
    and(/^both schemas should require the same fields$/, () => {
      expect(requiredKeys(deviceParseFmSchema.shape)).toEqual(requiredKeys(deviceParseSchema.shape));
    });
  });
});

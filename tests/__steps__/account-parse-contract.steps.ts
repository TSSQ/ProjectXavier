import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { normalizeAccountParseOutput, AccountExtraction } from '../../src/domain/accountParsePrompt';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-parse-contract.feature')
);

defineFeature(feature, (test) => {
  let rawName: string;
  let rawSubtype: string;
  let sourceText: string;
  let result: AccountExtraction;

  test('A hallucinated name with no token support in the text is discarded', ({
    given,
    when,
    then,
  }) => {
    given(
      /^a model output name "(.*)" and subtype "(.*)" for source text "(.*)"$/,
      (name: string, subtype: string, text: string) => {
        rawName = name;
        rawSubtype = subtype;
        sourceText = text;
      }
    );
    when(/^I normalize the account extraction with subtype hint "(.*)"$/, (hint: string) => {
      result = normalizeAccountParseOutput(
        { name: rawName, subtype: rawSubtype },
        sourceText,
        hint || undefined
      );
    });
    then(/^the normalized name should be null$/, () => {
      expect(result.name).toBeNull();
    });
  });

  test('A genuine name with token support survives', ({ given, when, then }) => {
    given(
      /^a model output name "(.*)" and subtype "(.*)" for source text "(.*)"$/,
      (name: string, subtype: string, text: string) => {
        rawName = name;
        rawSubtype = subtype;
        sourceText = text;
      }
    );
    when(/^I normalize the account extraction with subtype hint "(.*)"$/, (hint: string) => {
      result = normalizeAccountParseOutput(
        { name: rawName, subtype: rawSubtype },
        sourceText,
        hint || undefined
      );
    });
    then(/^the normalized name should be "(.*)"$/, (expected: string) => {
      expect(result.name).toBe(expected);
    });
  });

  test("An \"unknown\" subtype falls back to the gate's hint; a known subtype is kept as-is", ({
    given,
    when,
    then,
  }) => {
    given(
      /^a model output name "(.*)" and subtype "(.*)" for source text "(.*)"$/,
      (name: string, subtype: string, text: string) => {
        rawName = name;
        rawSubtype = subtype;
        sourceText = text;
      }
    );
    when(/^I normalize the account extraction with subtype hint "(.*)"$/, (hint: string) => {
      result = normalizeAccountParseOutput(
        { name: rawName, subtype: rawSubtype },
        sourceText,
        hint || undefined
      );
    });
    then(/^the normalized subtype should be "(.*)"$/, (expected: string) => {
      expect(result.subtype).toBe(expected);
    });
  });

  test('A subtype outside the known set is treated as unknown', ({ given, when, then }) => {
    given(
      /^a model output name "(.*)" and subtype "(.*)" for source text "(.*)"$/,
      (name: string, subtype: string, text: string) => {
        rawName = name;
        rawSubtype = subtype;
        sourceText = text;
      }
    );
    when(/^I normalize the account extraction with subtype hint "(.*)"$/, (hint: string) => {
      result = normalizeAccountParseOutput(
        { name: rawName, subtype: rawSubtype },
        sourceText,
        hint || undefined
      );
    });
    then(/^the normalized subtype should be "(.*)"$/, (expected: string) => {
      expect(result.subtype).toBe(expected);
    });
  });
});

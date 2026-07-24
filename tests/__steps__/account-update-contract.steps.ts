import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  normalizeAccountUpdateOutput,
  AccountUpdateDraftExtraction,
} from '../../src/domain/accountUpdatePrompt';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-update-contract.feature')
);

defineFeature(feature, (test) => {
  let raw: { targetName: string; operation: string; newName: string; newSubtype: string };
  let sourceText: string;
  let result: AccountUpdateDraftExtraction;

  const givenModelOutput = (
    targetName: string,
    operation: string,
    newName: string,
    newSubtype: string,
    text: string
  ) => {
    raw = { targetName, operation, newName, newSubtype };
    sourceText = text;
  };
  const whenNormalize = (hint: string) => {
    result = normalizeAccountUpdateOutput(raw, sourceText, hint || undefined);
  };

  test('A hallucinated target with no token support in the text is discarded', ({
    given,
    when,
    then,
  }) => {
    given(
      /^a model update output targetName "(.*)" operation "(.*)" newName "(.*)" newSubtype "(.*)" for source text "(.*)"$/,
      givenModelOutput
    );
    when(/^I normalize the account update extraction with subtype hint "(.*)"$/, whenNormalize);
    then(/^the normalized targetName should be null$/, () => {
      expect(result.targetName).toBeNull();
    });
  });

  test('A genuine target and new name with token support survive', ({ given, when, then, and }) => {
    given(
      /^a model update output targetName "(.*)" operation "(.*)" newName "(.*)" newSubtype "(.*)" for source text "(.*)"$/,
      givenModelOutput
    );
    when(/^I normalize the account update extraction with subtype hint "(.*)"$/, whenNormalize);
    then(/^the normalized targetName should be "(.*)"$/, (expected: string) => {
      expect(result.targetName).toBe(expected);
    });
    and(/^the normalized newName should be "(.*)"$/, (expected: string) => {
      expect(result.newName).toBe(expected);
    });
    and(/^the normalized operation should be "(.*)"$/, (expected: string) => {
      expect(result.operation).toBe(expected);
    });
  });

  test("An \"unknown\" newSubtype falls back to the gate's hint; a known subtype is kept as-is", ({
    given,
    when,
    then,
  }) => {
    given(
      /^a model update output targetName "(.*)" operation "(.*)" newName "(.*)" newSubtype "(.*)" for source text "(.*)"$/,
      givenModelOutput
    );
    when(/^I normalize the account update extraction with subtype hint "(.*)"$/, whenNormalize);
    then(/^the normalized newSubtype should be "(.*)"$/, (expected: string) => {
      expect(result.newSubtype).toBe(expected);
    });
  });

  test('An operation outside the known set is treated as unknown', ({ given, when, then }) => {
    given(
      /^a model update output targetName "(.*)" operation "(.*)" newName "(.*)" newSubtype "(.*)" for source text "(.*)"$/,
      givenModelOutput
    );
    when(/^I normalize the account update extraction with subtype hint "(.*)"$/, whenNormalize);
    then(/^the normalized operation should be "(.*)"$/, (expected: string) => {
      expect(result.operation).toBe(expected);
    });
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { checkDeletePreflight, DeletePreflightResult } from '../../src/domain/deletePreflight';

const feature = loadFeature(path.resolve(__dirname, '../__features__/delete-preflight.feature'));

defineFeature(feature, (test) => {
  let icloudAvailable: boolean;
  let result: DeletePreflightResult;

  test('iCloud available — delete is allowed, no message', ({ given, when, then, and }) => {
    given('iCloud is available', () => {
      icloudAvailable = true;
    });
    when(/^I check the delete preflight$/, () => {
      result = checkDeletePreflight(icloudAvailable);
    });
    then(/^the delete should be allowed$/, () => {
      expect(result.allowed).toBe(true);
    });
    and(/^there should be no preflight message$/, () => {
      expect(result.message).toBeNull();
    });
  });

  test('iCloud unavailable — delete is blocked with an actionable message', ({
    given,
    when,
    then,
    and,
  }) => {
    given('iCloud is not available', () => {
      icloudAvailable = false;
    });
    when(/^I check the delete preflight$/, () => {
      result = checkDeletePreflight(icloudAvailable);
    });
    then(/^the delete should be blocked$/, () => {
      expect(result.allowed).toBe(false);
    });
    and(/^the preflight message should mention "(.*)"$/, (text: string) => {
      expect(result.message).toContain(text);
    });
  });
});

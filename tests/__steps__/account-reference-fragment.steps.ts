import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { extractAccountReferenceFragment } from '../../src/domain/accountIntent';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-reference-fragment.feature')
);

defineFeature(feature, (test) => {
  test('Strips verb + determiners + a trailing generic "account"', ({ then }) => {
    then(
      /^extracting the reference fragment from "(.*)" should give "(.*)"$/,
      (text: string, fragment: string) => {
        expect(extractAccountReferenceFragment(text)).toBe(fragment);
      }
    );
  });
});

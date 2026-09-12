import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { accountSubtypeLabel } from '../../src/domain/accountSubtypeLabel';
import { ACCOUNT_SUBTYPE_CHOICES } from '../../src/domain/accountAssistant';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-subtype-label.feature'));

defineFeature(feature, (test) => {
  let stored: string | null | undefined;
  let label: string | null;
  let everyLabel: { value: string; label: string | null }[];

  const givenStored = (given: any) =>
    given(/^the stored subtype "(.*)"$/, (s: string) => {
      stored = s;
    });

  const whenLabelled = (when: any) =>
    when(/^I label it for display$/, () => {
      label = accountSubtypeLabel(stored);
    });

  for (const [name, expected] of [
    ['A known subtype uses its own label', 'Credit card'],
    ['A subtype the user invented is humanised rather than shown raw', 'My piggy bank'],
    ["A user's own casing in later words is left alone", 'Dbs multiplier'],
    ['Repeated separators collapse to single spaces', 'Joint account'],
    ['A hyphenated subtype is humanised too', 'E wallet'],
    ['A known subtype typed in a different case still finds its label', 'Credit card'],
  ] as const) {
    test(name, ({ given, when, then }) => {
      givenStored(given);
      whenLabelled(when);
      then(/^the label should be "(.*)"$/, (want: string) => {
        expect(label).toBe(want);
        expect(want).toBe(expected); // the feature file and this table agree
      });
    });
  }

  test('Every known subtype has a label that is not the raw value', ({ given, when, then, and }) => {
    given(/^every subtype the app offers as a choice$/, () => {
      expect(ACCOUNT_SUBTYPE_CHOICES.length).toBeGreaterThan(0);
    });
    when(/^I label each one for display$/, () => {
      everyLabel = ACCOUNT_SUBTYPE_CHOICES.map((c) => ({
        value: c.value,
        label: accountSubtypeLabel(c.value),
      }));
    });
    then(/^none of the labels should contain an underscore$/, () => {
      for (const { value, label: l } of everyLabel) {
        expect(l).not.toBeNull();
        expect(l).not.toContain('_');
        expect(l).toBe(ACCOUNT_SUBTYPE_CHOICES.find((c) => c.value === value)!.label);
      }
    });
    and(/^none of the labels should equal its stored value$/, () => {
      // Guards the real defect: a site that rendered the stored value verbatim
      // would pass a laxer assertion, since "bank" and "Bank" differ only in
      // case. Any value carrying a separator must come back changed.
      for (const { value, label: l } of everyLabel) {
        if (value.includes('_')) expect(l).not.toBe(value);
      }
    });
  });

  for (const name of [
    'The unknown sentinel renders nothing at all',
    'A blank subtype renders nothing at all',
  ]) {
    test(name, ({ given, when, then }) => {
      givenStored(given);
      whenLabelled(when);
      then(/^there should be no label$/, () => {
        expect(label).toBeNull();
      });
    });
  }

  test('A missing subtype renders nothing at all', ({ given, when, then }) => {
    given(/^no stored subtype$/, () => {
      stored = undefined;
    });
    whenLabelled(when);
    then(/^there should be no label$/, () => {
      expect(label).toBeNull();
      expect(accountSubtypeLabel(null)).toBeNull();
    });
  });
});

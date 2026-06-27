import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ACCOUNT_ICONS,
  CATEGORY_ICONS,
  displayedIcons,
} from '../../src/domain/icons';
import { accountIcon } from '../../src/lib/accountIcon';
import { accountSchema } from '../../src/lib/validation';

/** A minimal valid account, for exercising the schema with different icons. */
const baseAccount = {
  id: 'a1',
  name: 'Test',
  currency: 'USD',
  openingBalance: 0,
};

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/icon-sets.feature')
);

defineFeature(feature, (test) => {
  // ── Icon set tests ────────────────────────────────────────────────────────

  test('ACCOUNT_ICONS is non-empty and duplicate-free', ({ given, then, and }) => {
    let icons: string[] = [];

    given('the ACCOUNT_ICONS list', () => {
      icons = ACCOUNT_ICONS;
    });

    then('it should be non-empty', () => {
      expect(icons.length).toBeGreaterThan(0);
    });

    and('it should contain no duplicates', () => {
      const unique = new Set(icons);
      expect(unique.size).toBe(icons.length);
    });
  });

  test('CATEGORY_ICONS is non-empty and duplicate-free', ({ given, then, and }) => {
    let icons: string[] = [];

    given('the CATEGORY_ICONS list', () => {
      icons = CATEGORY_ICONS;
    });

    then('it should be non-empty', () => {
      expect(icons.length).toBeGreaterThan(0);
    });

    and('it should contain no duplicates', () => {
      const unique = new Set(icons);
      expect(unique.size).toBe(icons.length);
    });
  });

  // ── accountIcon tests ──────────────────────────────────────────────────────

  let result: { emoji: string; bg: string };

  test('accountIcon prefers a stored icon over the subtype default', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an account with subtype "(.*)" and icon "(.*)"$/, (subtype, icon) => {
      result = accountIcon({ subtype, icon });
    });

    when('I call accountIcon', () => {
      // already called in given
    });

    then(/^the emoji should be "(.*)"$/, (expected) => {
      expect(result.emoji).toBe(expected);
    });

    and(/^the bg should be "(.*)"$/, (expected) => {
      expect(result.bg).toBe(expected);
    });
  });

  test('accountIcon falls back to subtype emoji when icon is null', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an account with subtype "(.*)" and icon null$/, (subtype) => {
      result = accountIcon({ subtype, icon: null });
    });

    when('I call accountIcon', () => {
      // already called in given
    });

    then(/^the emoji should be "(.*)"$/, (expected) => {
      expect(result.emoji).toBe(expected);
    });

    and(/^the bg should be "(.*)"$/, (expected) => {
      expect(result.bg).toBe(expected);
    });
  });

  test('accountIcon falls back to default emoji for unknown subtype', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an account with subtype "(.*)" and icon null$/, (subtype) => {
      result = accountIcon({ subtype, icon: null });
    });

    when('I call accountIcon', () => {
      // already called in given
    });

    then(/^the emoji should be "(.*)"$/, (expected) => {
      expect(result.emoji).toBe(expected);
    });

    and(/^the bg should be "(.*)"$/, (expected) => {
      expect(result.bg).toBe(expected);
    });
  });

  // ── displayedIcons (picker prepend rule) ───────────────────────────────────

  test('A custom icon not in the set is prepended and stays selectable', ({
    given,
    when,
    then,
    and,
  }) => {
    let custom = '';
    let displayed: string[] = [];
    given(/^the category set and a custom value "(.*)"$/, (v: string) => {
      custom = v;
    });
    when('I compute the displayed icons', () => {
      displayed = displayedIcons(CATEGORY_ICONS, custom);
    });
    then(/^"(.*)" should be first in the displayed list$/, (expected: string) => {
      expect(displayed[0]).toBe(expected);
    });
    and('the displayed list should be one longer than the set', () => {
      expect(displayed.length).toBe(CATEGORY_ICONS.length + 1);
    });
  });

  test('An icon already in the set is not duplicated', ({ given, when, then }) => {
    let value = '';
    let displayed: string[] = [];
    given('the category set and a value already in the set', () => {
      value = CATEGORY_ICONS[0]!;
    });
    when('I compute the displayed icons', () => {
      displayed = displayedIcons(CATEGORY_ICONS, value);
    });
    then('the displayed list should equal the set', () => {
      expect(displayed).toEqual(CATEGORY_ICONS);
    });
  });

  test('No value leaves the set unchanged', ({ given, when, then }) => {
    let displayed: string[] = [];
    given('the category set and an empty value', () => {
      // no value
    });
    when('I compute the displayed icons', () => {
      displayed = displayedIcons(CATEGORY_ICONS, '');
    });
    then('the displayed list should equal the set', () => {
      expect(displayed).toEqual(CATEGORY_ICONS);
    });
  });

  // ── accountSchema icon length ──────────────────────────────────────────────

  test('An over-long account icon is rejected by validation', ({ given, then }) => {
    let icon = '';
    given(/^an account icon of (\d+) characters$/, (n: string) => {
      icon = 'x'.repeat(Number(n));
    });
    then('the account schema should reject it', () => {
      expect(accountSchema.safeParse({ ...baseAccount, icon }).success).toBe(false);
    });
  });

  test('A single-emoji account icon is accepted by validation', ({ given, then }) => {
    let icon = '';
    given(/^an account icon "(.*)"$/, (v: string) => {
      icon = v;
    });
    then('the account schema should accept it', () => {
      expect(accountSchema.safeParse({ ...baseAccount, icon }).success).toBe(true);
    });
  });
});

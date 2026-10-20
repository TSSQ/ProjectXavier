import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  groupByLetter,
  indexKey,
  letterIndexAt,
  nearestPopulatedKey,
  shouldShowRail,
  sortByName,
} from '../../src/domain/alphaIndex';

const feature = loadFeature(path.resolve(__dirname, '../__features__/alpha-index.feature'));

const asItems = (names: string[]) => names.map((name) => ({ name }));

defineFeature(feature, (test) => {
  let input: { name: string }[] = [];
  let sorted: { name: string }[] = [];

  test('Names sort case-insensitively', ({ when, then }) => {
    when(/^I sort the names (.+)$/, (list: string) => {
      input = asItems(parseList(list));
      sorted = sortByName(input);
    });
    then(/^the order is (.+)$/, (list: string) => {
      expect(sorted.map((i) => i.name)).toEqual(parseList(list));
    });
  });

  test('Numbers inside names sort numerically', ({ when, then }) => {
    when(/^I sort the names (.+)$/, (list: string) => {
      sorted = sortByName(asItems(parseList(list)));
    });
    then(/^the order is (.+)$/, (list: string) => {
      expect(sorted.map((i) => i.name)).toEqual(parseList(list));
    });
  });

  test('Sorting does not mutate the input', ({ when, then }) => {
    when(/^I sort the names (.+)$/, (list: string) => {
      input = asItems(parseList(list));
      sortByName(input);
    });
    then(/^the original input is still (.+)$/, (list: string) => {
      expect(input.map((i) => i.name)).toEqual(parseList(list));
    });
  });

  test('Diacritics index under their base letter', ({ then }) => {
    then(/^the index key of "(.*)" is "(.*)"$/, (name: string, key: string) => {
      expect(indexKey(name)).toBe(key);
    });
  });

  test('Non-letters index under hash', ({ then, and }) => {
    const check = (name: string, key: string) => expect(indexKey(name)).toBe(key);
    then(/^the index key of "(.*)" is "(.*)"$/, check);
    and(/^the index key of "(.*)" is "(.*)"$/, check);
    and(/^the index key of "(.*)" is "(.*)"$/, check);
  });

  test('The hash group is last', ({ when, then }) => {
    let keys: string[] = [];
    when(/^I group the names (.+)$/, (list: string) => {
      keys = groupByLetter(asItems(parseList(list))).map((g) => g.key);
    });
    then(/^the group keys are (.+)$/, (list: string) => {
      expect(keys).toEqual(parseList(list));
    });
  });

  const nearest = (then: (re: RegExp, fn: (...a: string[]) => void) => void) =>
    then(
      /^with populated keys (.+) the nearest to "(.)" is (.+)$/,
      (populated: string, key: string, expected: string) => {
        const set = new Set(populated === 'none' ? [] : parseList(populated));
        const want = expected === 'none' ? null : parseList(expected)[0];
        expect(nearestPopulatedKey(key, set)).toBe(want);
      }
    );

  test('Sliding onto an empty letter snaps forward', ({ then }) => nearest(then));
  test('Past the last populated letter falls back backward', ({ then }) => nearest(then));
  test('Nothing populated gives no key', ({ then }) => nearest(then));

  test('The rail shows only for long, unsearched lists', ({ then }) => {
    then(
      /^the rail for (\d+) items and query "(.*)" is shown: (yes|no)$/,
      (count: string, query: string, shown: string) => {
        expect(shouldShowRail(Number(count), query)).toBe(shown === 'yes');
      }
    );
  });

  test('Leading whitespace is ignored for the index key', ({ then }) => {
    then(/^the index key of "(.*)" is "(.*)"$/, (name: string, key: string) => {
      expect(indexKey(name)).toBe(key);
    });
  });

  test('Tilde letters index under their base letter', ({ then }) => {
    then(/^the index key of "(.*)" is "(.*)"$/, (name: string, key: string) => {
      expect(indexKey(name)).toBe(key);
    });
  });

  test('A lone combining mark indexes under hash', ({ then }) => {
    then(/^the index key of a lone combining acute accent is "(.*)"$/, (key: string) => {
      expect(indexKey('\u0301')).toBe(key);
    });
  });

  test('Hash mixes with letters and still sorts last', ({ when, then }) => {
    let keys: string[] = [];
    when(/^I group the names (.+)$/, (list: string) => {
      keys = groupByLetter(asItems(parseList(list))).map((g) => g.key);
    });
    then(/^the group keys are (.+)$/, (list: string) => {
      expect(keys).toEqual(parseList(list));
    });
  });

  test('An unknown key resolves to nothing', ({ then }) => nearest(then));

  test('A touch position maps to a letter slot', ({ then }) => {
    then(
      /^a touch at (-?\d+) on a rail of height (\d+) with (\d+) slots maps to (\d+|none)$/,
      (y: string, height: string, count: string, index: string) => {
        expect(letterIndexAt(Number(y), Number(height), Number(count))).toBe(
          index === 'none' ? null : Number(index)
        );
      }
    );
  });

  test('A whitespace-only query counts as empty', ({ then }) => {
    then(/^the rail for 20 items and a blank query is shown$/, () => {
      expect(shouldShowRail(20, '   ')).toBe(true);
    });
  });
});

describe('repository ordering guard', () => {
  it.each(['payees', 'categories'])(
    '%s repository stays in insertion order (protects FM prompt order)',
    (feat) => {
      const src = fs.readFileSync(
        path.resolve(__dirname, `../../src/features/${feat}/repository.ts`),
        'utf8'
      );
      expect(src).not.toMatch(/orderBy/);
      expect(src).not.toMatch(/order by/i);
      expect(src).not.toMatch(/\.sort\(/);
    }
  );
});

describe('payees scroll ref guard', () => {
  // NativeWind's interop wrapper drops `ref` on RN 0.81's function-component
  // ScrollView, so letter jumps need the ScrollView to opt out of interop.
  // Found on the simulator; nothing in the Node suite renders views.
  it('the jump-target ScrollView opts out of css interop', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/manage-payees.tsx'), 'utf8');
    expect(src).toMatch(/<ScrollView[^>]*cssInterop=\{false\}[^>]*ref=\{scrollRef\}/);
  });
  it("the picker FlatList scrolls through a ScrollView that keeps FlatList's ref", () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/ui/Combobox.tsx'), 'utf8');
    expect(src).toMatch(/<ScrollView \{\.\.\.props\} cssInterop=\{false\} \/>/);
    expect(src).toMatch(/renderScrollComponent=\{renderPlainScroll\}/);
  });
});

function parseList(s: string): string[] {
  return Array.from(s.matchAll(/"([^"]*)"/g)).map((m) => m[1] as string);
}

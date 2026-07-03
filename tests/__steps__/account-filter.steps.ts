import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  Selection,
  isAllSelected,
  effectiveIds,
  toggleAccount,
  scopeLabel,
  pillsSplit,
  applyLabel,
  commitDraft,
} from '../../src/domain/accountFilter';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-filter.feature')
);

const ACCOUNT_IDS = ['a', 'b', 'c'];

function parseAccounts(raw: string): { id: string; name: string }[] {
  // format: "a=Alpha,b=Beta,c=Gamma"
  return raw.split(',').map((pair) => {
    const [id, name] = pair.split('=');
    return { id: id!, name: name! };
  });
}

defineFeature(feature, (test) => {
  // ── isAllSelected ─────────────────────────────────────────────────────────
  test('Default selection is all accounts', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('isAllSelected should be true', () => {
      expect(isAllSelected(sel)).toBe(true);
    });
  });

  test('An explicit list is not all-selected', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a,b"', () => { sel = ['a', 'b']; });
    then('isAllSelected should be false', () => {
      expect(isAllSelected(sel)).toBe(false);
    });
  });

  // ── toggleAccount ─────────────────────────────────────────────────────────
  test('Toggle one account from all-selected focuses on that account', ({ given, when, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    when('I toggle account "a" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'a', ACCOUNT_IDS);
    });
    then('the selection should be "a"', () => {
      expect(sel).toEqual(['a']);
    });
  });

  test('Toggle adds an account to the set', ({ given, when, then }) => {
    let sel: Selection;
    given('a selection of ids "a"', () => { sel = ['a']; });
    when('I toggle account "b" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'b', ACCOUNT_IDS);
    });
    then('the selection should be "a,b"', () => {
      expect(new Set(sel as string[])).toEqual(new Set(['a', 'b']));
    });
  });

  test('Toggle removes an account from the set', ({ given, when, then }) => {
    let sel: Selection;
    given('a selection of ids "a,b"', () => { sel = ['a', 'b']; });
    when('I toggle account "a" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'a', ACCOUNT_IDS);
    });
    then('the selection should be "b"', () => {
      expect(sel).toEqual(['b']);
    });
  });

  test('Toggle to empty set becomes null (all)', ({ given, when, then }) => {
    let sel: Selection;
    given('a selection of ids "a"', () => { sel = ['a']; });
    when('I toggle account "a" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'a', ACCOUNT_IDS);
    });
    then('the selection should be null', () => {
      expect(sel).toBeNull();
    });
  });

  test('Toggle to full set becomes null (all)', ({ given, when, then }) => {
    let sel: Selection;
    given('a selection of ids "a,b"', () => { sel = ['a', 'b']; });
    when('I toggle account "c" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'c', ACCOUNT_IDS);
    });
    then('the selection should be null', () => {
      expect(sel).toBeNull();
    });
  });

  // ── scopeLabel ────────────────────────────────────────────────────────────
  test('scopeLabel for all-selected is "All accounts"', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('scopeLabel should be "All accounts"', () => {
      const accounts = ACCOUNT_IDS.map((id) => ({ id, name: id }));
      expect(scopeLabel(sel, accounts)).toBe('All accounts');
    });
  });

  test('scopeLabel for one account shows its name', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "b"', () => { sel = ['b']; });
    then(/^scopeLabel with names "(.*)" should be "(.*)"$/, (rawNames: string, expected: string) => {
      const accounts = parseAccounts(rawNames);
      expect(scopeLabel(sel, accounts)).toBe(expected);
    });
  });

  test('scopeLabel for multiple accounts shows count', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a,c"', () => { sel = ['a', 'c']; });
    then(/^scopeLabel with names "(.*)" should be "(.*)"$/, (rawNames: string, expected: string) => {
      const accounts = parseAccounts(rawNames);
      expect(scopeLabel(sel, accounts)).toBe(expected);
    });
  });

  // ── pillsSplit ────────────────────────────────────────────────────────────
  test('All selected shows first 3 accounts inline', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('pillsSplit with cap 3 and 4 accounts gives 3 inline and 1 more', () => {
      const accounts = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
      const { inline, moreCount } = pillsSplit(accounts, sel, 3);
      expect(inline.length).toBe(3);
      expect(moreCount).toBe(1);
    });
  });

  test('Subset selection shows only selected accounts', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a,c"', () => { sel = ['a', 'c']; });
    then('pillsSplit with cap 3 and 3 accounts gives 2 inline and 1 more', () => {
      const accounts = ACCOUNT_IDS.map((id) => ({ id, name: id }));
      const { inline, moreCount } = pillsSplit(accounts, sel, 3);
      expect(inline.length).toBe(2);
      expect(moreCount).toBe(1);
    });
  });

  // ── applyLabel ────────────────────────────────────────────────────────────
  test('Apply with all accounts selected shows all-accounts label', ({ then }) => {
    then('applyLabel for 3 of 3 should be "Show all accounts"', () => {
      expect(applyLabel(3, 3)).toBe('Show all accounts');
    });
  });

  test('Apply with zero accounts selected shows all-accounts label', ({ then }) => {
    then('applyLabel for 0 of 3 should be "Show all accounts"', () => {
      expect(applyLabel(0, 3)).toBe('Show all accounts');
    });
  });

  test('Apply with one account shows singular label', ({ then }) => {
    then('applyLabel for 1 of 3 should be "Show 1 account"', () => {
      expect(applyLabel(1, 3)).toBe('Show 1 account');
    });
  });

  test('Apply with multiple accounts shows plural label', ({ then }) => {
    then('applyLabel for 2 of 3 should be "Show 2 accounts"', () => {
      expect(applyLabel(2, 3)).toBe('Show 2 accounts');
    });
  });

  // ── effectiveIds ──────────────────────────────────────────────────────────
  test('effectiveIds drops a deleted id', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a,z"', () => { sel = ['a', 'z']; });
    then('effectiveIds with accountIds "a,b,c" should be "a"', () => {
      const result = effectiveIds(sel, ACCOUNT_IDS);
      expect(result).toEqual(['a']);
    });
  });

  test('effectiveIds falls back to all when every selected id is gone', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "z"', () => { sel = ['z']; });
    then('effectiveIds with accountIds "a,b,c" should be "a,b,c"', () => {
      const result = effectiveIds(sel, ACCOUNT_IDS);
      expect(result).toEqual(ACCOUNT_IDS);
    });
  });

  test('effectiveIds with null selection returns all ids', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('effectiveIds with accountIds "a,b,c" should be "a,b,c"', () => {
      const result = effectiveIds(sel, ACCOUNT_IDS);
      expect(result).toEqual(ACCOUNT_IDS);
    });
  });

  test('effectiveIds retains partial-valid ids without falling back', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a,b"', () => { sel = ['a', 'b']; });
    then('effectiveIds with accountIds "a,b,c" should be "a,b"', () => {
      const result = effectiveIds(sel, ACCOUNT_IDS);
      expect(result).toEqual(['a', 'b']);
    });
  });

  // ── toggleAccount (unknown id) ────────────────────────────────────────────
  test('Toggle an unknown id passes through without collapsing to all', ({ given, when, then }) => {
    let sel: Selection;
    given('a selection of ids "a"', () => { sel = ['a']; });
    when('I toggle account "z" with ids "a,b,c"', () => {
      sel = toggleAccount(sel, 'z', ACCOUNT_IDS);
    });
    then('the selection should be "a,z"', () => {
      expect(new Set(sel as string[])).toEqual(new Set(['a', 'z']));
    });
  });

  // ── scopeLabel (Fix 2 coverage) ───────────────────────────────────────────
  test('scopeLabel with all-stale ids falls back to All accounts', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "z"', () => { sel = ['z']; });
    then(/^scopeLabel with names "(.*)" should be "(.*)"$/, (rawNames: string, expected: string) => {
      const accounts = parseAccounts(rawNames);
      expect(scopeLabel(sel, accounts)).toBe(expected);
    });
  });

  test('scopeLabel for one valid of two accounts shows account name', ({ given, then }) => {
    let sel: Selection;
    given('a selection of ids "a"', () => { sel = ['a']; });
    then(/^scopeLabel with names "(.*)" should be "(.*)"$/, (rawNames: string, expected: string) => {
      const accounts = parseAccounts(rawNames);
      expect(scopeLabel(sel, accounts)).toBe(expected);
    });
  });

  // ── pillsSplit (edge cases) ───────────────────────────────────────────────
  test('pillsSplit with cap larger than accounts shows all inline with no more', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('pillsSplit with cap 999 and 3 accounts gives 3 inline and 0 more', () => {
      const accounts = ACCOUNT_IDS.map((id) => ({ id, name: id }));
      const { inline, moreCount } = pillsSplit(accounts, sel, 999);
      expect(inline.length).toBe(3);
      expect(moreCount).toBe(0);
    });
  });

  test('pillsSplit with empty account list gives empty inline and no more', ({ given, then }) => {
    let sel: Selection;
    given('a null selection', () => { sel = null; });
    then('pillsSplit with cap 3 and 0 accounts gives 0 inline and 0 more', () => {
      const { inline, moreCount } = pillsSplit([], sel, 3);
      expect(inline.length).toBe(0);
      expect(moreCount).toBe(0);
    });
  });

  // ── commitDraft ───────────────────────────────────────────────────────────
  test('commitDraft with single account equal to total collapses to null', ({ then }) => {
    then('commitDraft with ids "a" and total 1 should be null', () => {
      expect(commitDraft(['a'], 1)).toBeNull();
    });
  });

  // ── applyLabel (additional cases) ────────────────────────────────────────
  test('Apply with two of three accounts shows plural label', ({ then }) => {
    then('applyLabel for 2 of 3 should be "Show 2 accounts"', () => {
      expect(applyLabel(2, 3)).toBe('Show 2 accounts');
    });
  });

  test('Apply with zero of zero accounts shows all-accounts label', ({ then }) => {
    then('applyLabel for 0 of 0 should be "Show all accounts"', () => {
      expect(applyLabel(0, 0)).toBe('Show all accounts');
    });
  });
});

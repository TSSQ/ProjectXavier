import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { findAccountMatch, AccountMatch } from '../../src/domain/accountMatch';
import { extractAccountReferenceFragment } from '../../src/domain/accountIntent';
import { Account } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-match.feature'));

const KNOWN_ACCOUNTS: Account[] = [
  { id: 'acc-dbs', name: 'DBS Savings', subtype: 'bank', currency: 'USD', openingBalance: 0 },
  { id: 'acc-ocbc', name: 'OCBC Current', subtype: 'bank', currency: 'USD', openingBalance: 0 },
  { id: 'acc-cash', name: 'Cash Wallet', subtype: 'cash', currency: 'USD', openingBalance: 0 },
  { id: 'acc-amex', name: 'Amex', subtype: 'credit_card', currency: 'USD', openingBalance: 0 },
];

defineFeature(feature, (test) => {
  let accounts: Account[];
  let result: AccountMatch | null;

  const givenKnownAccounts = () => {
    accounts = KNOWN_ACCOUNTS;
  };
  const whenFind = (text: string) => {
    result = findAccountMatch(text, accounts);
  };

  test('Resolution ladder — exact, case-insensitive, token/substring, subtype cue', ({
    given,
    when,
    then,
  }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for "(.*)"$/, whenFind);
    then(/^the matched account should be "(.*)"$/, (name: string) => {
      expect(result).not.toBeNull();
      expect(result?.account?.name).toBe(name);
    });
  });

  test('A fuzzy near-miss is offered as a suggestion, not auto-resolved', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for "(.*)"$/, whenFind);
    then(/^the match should suggest "(.*)"$/, (name: string) => {
      expect(result?.suggestion?.name).toBe(name);
    });
    and(/^the match should not resolve an account$/, () => {
      expect(result?.account).toBeUndefined();
    });
  });

  test('Two accounts of the same subtype with no distinguishing cue word are ambiguous', ({
    given,
    when,
    then,
  }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for "(.*)"$/, whenFind);
    then(/^the match should be ambiguous$/, () => {
      expect(result?.ambiguous).toBeDefined();
      expect(result?.ambiguous?.length).toBeGreaterThanOrEqual(2);
      expect(result?.account).toBeUndefined();
    });
  });

  test('No match at all returns null', ({ given, when, then }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for "(.*)"$/, whenFind);
    then(/^there should be no match at all$/, () => {
      expect(result).toBeNull();
    });
  });

  test('A shared CATEGORY cue word ("card") is never a valid disambiguator between two same-subtype accounts (QA MAJOR follow-up)', ({
    given,
    when,
    then,
  }) => {
    given(/^the known credit-card accounts Amex and Chase Card$/, () => {
      accounts = [
        { id: 'acc-amex', name: 'Amex', subtype: 'credit_card', currency: 'USD', openingBalance: 0 },
        {
          id: 'acc-chase',
          name: 'Chase Card',
          subtype: 'credit_card',
          currency: 'USD',
          openingBalance: 0,
        },
      ];
    });
    when(/^I find an account match for "(.*)"$/, whenFind);
    then(/^the match should be ambiguous$/, () => {
      expect(result?.ambiguous).toBeDefined();
      expect(result?.ambiguous?.length).toBe(2);
      expect(result?.account).toBeUndefined();
    });
  });

  // Reproduces the EXACT runtime pipeline (app/(tabs)/index.tsx's chat
  // delete path): extractAccountReferenceFragment(trimmed) THEN
  // findAccountMatch — not a pre-extracted fragment handed in directly.
  const whenFindDeleteSentence = (sentence: string) => {
    result = findAccountMatch(extractAccountReferenceFragment(sentence), accounts);
  };

  test('A full chat DELETE sentence resolves the real target, not just a pre-extracted fragment (QA MAJOR follow-up — the exact runtime pipeline: extractAccountReferenceFragment then findAccountMatch)', ({
    given,
    when,
    then,
  }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for the delete sentence "(.*)"$/, whenFindDeleteSentence);
    then(/^the matched account should be "(.*)"$/, (name: string) => {
      expect(result).not.toBeNull();
      expect(result?.account?.name).toBe(name);
    });
  });

  test('An ambiguous full DELETE sentence still asks "which account?" (QA MAJOR follow-up)', ({
    given,
    when,
    then,
  }) => {
    given(/^the known accounts .*$/, givenKnownAccounts);
    when(/^I find an account match for the delete sentence "(.*)"$/, whenFindDeleteSentence);
    then(/^the match should be ambiguous$/, () => {
      expect(result?.ambiguous).toBeDefined();
      expect(result?.ambiguous?.length).toBeGreaterThanOrEqual(2);
      expect(result?.account).toBeUndefined();
    });
  });
});

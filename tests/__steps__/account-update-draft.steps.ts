import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  buildAccountUpdateDraft,
  buildAccountUpdateClarifyMessage,
  AccountUpdateDraft,
} from '../../src/domain/accountUpdateAssistant';
import { AccountUpdateDraftExtraction } from '../../src/domain/accountUpdatePrompt';
import { Account } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-update-draft.feature'));

defineFeature(feature, (test) => {
  let account: Account;
  let draft: AccountUpdateDraft;

  const givenAccount = (name: string, subtype: string, balance: string) => {
    account = {
      id: 'acc-1',
      name,
      subtype,
      currency: 'USD',
      openingBalance: Number(balance),
    };
  };

  const buildDraft = (text: string, extraction: AccountUpdateDraftExtraction | null) => {
    draft = buildAccountUpdateDraft(text, account, extraction);
  };

  test('Deterministic verb-pattern classifies the operation without any model help', ({
    given,
    when,
    then,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(/^I build an account update draft for "(.*)" with no extraction$/, (text: string) =>
      buildDraft(text, null)
    );
    then(/^the draft operation should be "(.*)"$/, (op: string) => {
      expect(draft.op).toBe(op);
    });
  });

  test("The model's operation is used only when the deterministic classifier can't tell", ({
    given,
    when,
    then,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(
      /^I build an account update draft for "(.*)" with extraction operation "(.*)" newName "(.*)" newSubtype "(.*)"$/,
      (text: string, operation: string, newName: string, newSubtype: string) => {
        buildDraft(text, {
          targetName: null,
          operation: operation as AccountUpdateDraftExtraction['operation'],
          newName: newName || null,
          newSubtype: (newSubtype || 'unknown') as AccountUpdateDraftExtraction['newSubtype'],
        });
      }
    );
    then(/^the draft operation should be "(.*)"$/, (op: string) => {
      expect(draft.op).toBe(op);
    });
  });

  test("A rename/retype draft's balance is ALWAYS the account's existing balance, never parsed from the text", ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(/^I build an account update draft for "(.*)" with no extraction$/, (text: string) =>
      buildDraft(text, null)
    );
    then(/^the draft newBalance should be (\d+)$/, (expected: string) => {
      expect(draft.newBalance).toBe(Number(expected));
    });
    and(/^the draft balanceEdited should be (true|false)$/, (expected: string) => {
      expect(draft.balanceEdited).toBe(expected === 'true');
    });
  });

  test("A rebalance draft's balance IS parsed from the text, and marked edited", ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(/^I build an account update draft for "(.*)" with no extraction$/, (text: string) =>
      buildDraft(text, null)
    );
    then(/^the draft newBalance should be (\d+)$/, (expected: string) => {
      expect(draft.newBalance).toBe(Number(expected));
    });
    and(/^the draft balanceEdited should be (true|false)$/, (expected: string) => {
      expect(draft.balanceEdited).toBe(expected === 'true');
    });
  });

  test("An extraction's new name is used verbatim when present; otherwise the account's current name is kept", ({
    given,
    when,
    then,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(
      /^I build an account update draft for "(.*)" with extraction operation "(.*)" newName "(.*)" newSubtype "(.*)"$/,
      (text: string, operation: string, newName: string, newSubtype: string) => {
        buildDraft(text, {
          targetName: null,
          operation: operation as AccountUpdateDraftExtraction['operation'],
          newName: newName || null,
          newSubtype: (newSubtype || 'unknown') as AccountUpdateDraftExtraction['newSubtype'],
        });
      }
    );
    then(/^the draft newName should be "(.*)"$/, (expected: string) => {
      expect(draft.newName).toBe(expected);
    });
    when(/^I build an account update draft for "(.*)" with no extraction$/, (text: string) =>
      buildDraft(text, null)
    );
    then(/^the draft newName should be "(.*)"$/, (expected: string) => {
      expect(draft.newName).toBe(expected);
    });
  });

  test("An unclassifiable op with no model help yields 'unknown', which the chat flow turns into a clarify question, not a no-op card (QA MINOR follow-up)", ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^an existing account "(.*)" of subtype "(.*)" with balance (\d+)$/, givenAccount);
    when(/^I build an account update draft for "(.*)" with no extraction$/, (text: string) =>
      buildDraft(text, null)
    );
    then(/^the draft operation should be "(.*)"$/, (op: string) => {
      expect(draft.op).toBe(op);
    });
    and(/^the clarify message for "(.*)" should mention "(.*)"$/, (accountName: string, text: string) => {
      expect(buildAccountUpdateClarifyMessage(accountName)).toContain(text);
    });
  });
});

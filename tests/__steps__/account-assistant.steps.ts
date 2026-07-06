import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  isAccountCommand,
  transactionCommandBody,
  startAccountFlow,
  advanceAccountFlow,
  parseOpeningBalance,
  AccountFlowState,
  AccountFlowResult,
} from '../../src/domain/accountAssistant';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/account-assistant.feature')
);

defineFeature(feature, (test) => {
  let state: AccountFlowState;
  let result: AccountFlowResult;
  let balance: number;

  test('"/account" is recognised as the account command', ({ then, and }) => {
    then(/^"(.*)" is an account command$/, (text: string) => {
      expect(isAccountCommand(text)).toBe(true);
    });
    and(/^"(.*)" is an account command$/, (text: string) => {
      expect(isAccountCommand(text)).toBe(true);
    });
    and(/^"(.*)" is not an account command$/, (text: string) => {
      expect(isAccountCommand(text)).toBe(false);
    });
  });

  const start = () => {
    result = startAccountFlow();
    state = result.state;
  };
  const answer = (a: string) => {
    result = advanceAccountFlow(state, a);
    state = result.state;
  };

  test('The flow walks name, type, then balance to a ready draft', ({ when, then }) => {
    when(/^I start the account flow$/, start);
    then(/^the assistant asks for the account name$/, () => {
      expect(result.message.toLowerCase()).toContain('call it');
    });
    when(/^I answer "(.*)"$/, answer);
    then(/^the assistant asks for the type$/, () => {
      expect(result.message.toLowerCase()).toContain('type');
    });
    when(/^I answer "(.*)"$/, answer);
    then(/^the assistant asks for the starting balance$/, () => {
      expect(result.message.toLowerCase()).toContain('balance');
    });
    when(/^I answer "(.*)"$/, answer);
    then(/^the account draft is ready$/, () => {
      expect(result.ready).toBeDefined();
    });
    then(/^the ready account name is "(.*)"$/, (v: string) => {
      expect(result.ready?.name).toBe(v);
    });
    then(/^the ready account subtype is "(.*)"$/, (v: string) => {
      expect(result.ready?.subtype).toBe(v);
    });
    then(/^the ready account opening balance is (-?\d+)$/, (v: string) => {
      expect(result.ready?.openingBalance).toBe(parseInt(v, 10));
    });
  });

  test('"credit card" normalises to a credit_card subtype', ({ when, and, then }) => {
    when(/^I start the account flow$/, start);
    and(/^I answer "(.*)"$/, answer);
    and(/^I answer "(.*)"$/, answer);
    and(/^I answer "(.*)"$/, answer);
    then(/^the ready account subtype is "(.*)"$/, (v: string) => {
      expect(result.ready?.subtype).toBe(v);
    });
    and(/^the ready account opening balance is (-?\d+)$/, (v: string) => {
      expect(result.ready?.openingBalance).toBe(parseInt(v, 10));
    });
  });

  test('Skipping the type leaves it unset', ({ when, and, then }) => {
    when(/^I start the account flow$/, start);
    and(/^I answer "(.*)"$/, answer);
    and(/^I answer "(.*)"$/, answer);
    and(/^I answer "(.*)"$/, answer);
    then(/^the ready account has no subtype$/, () => {
      expect(result.ready?.subtype).toBeUndefined();
    });
  });

  test('An "owe" balance is stored negative', ({ when, then }) => {
    when(/^I resolve the opening balance from "(.*)"$/, (v: string) => {
      balance = parseOpeningBalance(v);
    });
    then(/^the opening balance should be (-?\d+)$/, (v: string) => {
      expect(balance).toBe(parseInt(v, 10));
    });
  });

  test('A plain dollar amount opening balance', ({ when, then }) => {
    when(/^I resolve the opening balance from "(.*)"$/, (v: string) => {
      balance = parseOpeningBalance(v);
    });
    then(/^the opening balance should be (-?\d+)$/, (v: string) => {
      expect(balance).toBe(parseInt(v, 10));
    });
  });

  test('An empty name is re-asked', ({ when, and, then }) => {
    when(/^I start the account flow$/, start);
    and(/^I answer "(.*)"$/, answer);
    then(/^the assistant asks for the account name$/, () => {
      expect(result.message.toLowerCase()).toContain('name');
    });
    and(/^the account draft is not ready$/, () => {
      expect(result.ready).toBeUndefined();
    });
  });

  test('"/transactions" yields its body for expense parsing', ({ then, and }) => {
    then(
      /^the transaction command body of "(.*)" is "(.*)"$/,
      (text: string, body: string) => {
        expect(transactionCommandBody(text)).toBe(body);
      }
    );
    and(/^the transaction command body of "(.*)" is null$/, (text: string) => {
      expect(transactionCommandBody(text)).toBeNull();
    });
  });

  test('A subtype chip label advances the flow exactly like the typed word', ({ when, and, then }) => {
    when(/^I start the account flow$/, start);
    and(/^I answer "(.*)"$/, answer);
    then(
      /^advancing with the chip label "(.*)" and typing "(.*)" reach the same subtype$/,
      (label: string, typed: string) => {
        const viaChip = advanceAccountFlow(state, label);
        const viaType = advanceAccountFlow(state, typed);
        expect(viaChip.state.draft.subtype).toBe(viaType.state.draft.subtype);
      }
    );
  });
});

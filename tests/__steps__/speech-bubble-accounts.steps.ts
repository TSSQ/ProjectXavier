import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  BubbleContent,
  accountArchivedText,
  accountCreatedReceipt,
  accountUpdatedText,
} from '../../src/domain/bubbleCopy';

// Intl uses a no-break space after the currency code; the feature writes a plain one.
const plain = (v: string | undefined) => v?.replace(/\u00a0/g, ' ');

defineFeature(
  loadFeature(path.resolve(__dirname, '../__features__/speech-bubble-accounts.feature')),
  (test) => {
    let content: BubbleContent;
    let text: string;
    let existing = { name: '', subtype: '', openingBalance: 0, currency: 'SGD' };

    const create = (name: string, kind: string, balance: string) => {
      content = accountCreatedReceipt({
        name,
        subtype: kind,
        openingBalance: Number(balance) * 100,
        currency: 'SGD',
      });
    };
    const existingStep = (name: string, kind: string, balance: string, currency: string) => {
      existing = { name, subtype: kind, openingBalance: Number(balance) * 100, currency };
    };
    const update = (name: string, kind: string, balance: string, edited: string) => {
      text = accountUpdatedText({
        existing,
        next: { name, subtype: kind, balance: Number(balance) * 100, balanceEdited: edited === 'yes' },
      });
    };
    const receipt = () => {
      if (content.kind !== 'receipt') throw new Error('expected a receipt');
      return content;
    };

    const createScenario = (checks: number) =>
      ({ when, then, and }: { when: any; then: any; and: any }) => {
        when(
          /^I create the account "(.*)" of kind "(.*)" with opening balance (\d+) SGD$/,
          create
        );
        const check = (line: string) => {
          let r = /^the receipt headline should be "(.*)"$/.exec(line);
          if (r) return expect(plain(receipt().headline)).toBe(r[1]);
          r = /^the receipt line should be "(.*)"$/.exec(line);
          if (r) return expect(plain(receipt().lines[0])).toBe(r[1]);
          throw new Error(`no check for: ${line}`);
        };
        then(/^(.*)$/, check);
        for (let i = 1; i < checks; i += 1) and(/^(.*)$/, check);
      };
    test('A created account shows its kind and opening balance', createScenario(2));
    test('A created account with no opening balance leaves it out', createScenario(1));

    const updateScenario = ({ given, when, then }: { given: any; when: any; then: any }) => {
      given(/^the account "(.*)" of kind "(.*)" with balance (\d+) (\w+)$/, existingStep);
      when(
        /^I update it to name "(.*)" kind "(.*)" balance (\d+) SGD, balance edited "(.*)"$/,
        update
      );
      then(/^the bubble text should be "(.*)"$/, (want: string) => expect(plain(text)).toBe(want));
    };
    test('A rename', updateScenario);
    test('A retype', updateScenario);
    test('A balance change', updateScenario);
    test('A combined change leads with the first change', updateScenario);

    test('An archived account', ({ then }) => {
      then(/^the archived text for "(.*)" should be "(.*)"$/, (name: string, want: string) =>
        expect(accountArchivedText(name)).toBe(want)
      );
    });
  }
);

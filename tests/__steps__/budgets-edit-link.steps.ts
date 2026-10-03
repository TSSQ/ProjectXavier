import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { decideEditLink, editLinkTxId } from '../../src/domain/editLink';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-edit-link.feature'));

defineFeature(feature, (test) => {
  let startSeq = 1; // newest start sequence handed out
  let loadedSeq = 1; // newest completed load
  let rowFound = false;
  let genAtToken = 0;
  let decision = '';
  const decide = () => {
    decision = decideEditLink({ rowFound, loadedSeq, genAtToken });
  };
  const thenDecision = (d: string) => expect(decision).toBe(d);

  test('A link to a row newer than the loaded ledger opens it after the focus refresh', ({ given, when, then }) => {
    given('the tab holds a ledger loaded once without the row', () => {
      startSeq = 1;
      loadedSeq = 1;
      rowFound = false;
    });
    when('the link arrives', () => {
      genAtToken = startSeq;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
    when('a refresh completes and the row is now in the ledger', () => {
      startSeq += 1;
      loadedSeq = startSeq;
      rowFound = true;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
  });

  test('A link to a deleted row is dropped after a refresh that still lacks it', ({ given, when, then }) => {
    given('the tab holds a ledger loaded once without the row', () => {
      startSeq = 1;
      loadedSeq = 1;
      rowFound = false;
    });
    when('the link arrives', () => {
      genAtToken = startSeq;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
    when('a refresh completes and the row is still absent', () => {
      startSeq += 1;
      loadedSeq = startSeq;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
  });

  test('A tap during an in-flight refresh that lacks the row waits for the next load and then opens', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the tab holds a ledger loaded once without the row', () => {
      startSeq = 1;
      loadedSeq = 1;
      rowFound = false;
    });
    and('a refresh has started but not finished', () => {
      startSeq = 2;
    });
    when('the link arrives', () => {
      genAtToken = startSeq;
      decide();
    });
    and('that in-flight refresh completes without the row', () => {
      loadedSeq = 2;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
    when('the next refresh starts, completes, and has the row', () => {
      startSeq = 3;
      loadedSeq = 3;
      rowFound = true;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
  });

  test('A row already in the ledger opens at once', ({ given, when, then }) => {
    given('the tab holds a ledger loaded once with the row', () => {
      startSeq = 1;
      loadedSeq = 1;
      rowFound = true;
    });
    when('the link arrives', () => {
      genAtToken = startSeq;
      decide();
    });
    then(/^the decision should be "(.*)"$/, thenDecision);
  });

  test('The tx id is read from the token', ({ then }) => {
    then(/^the id in "(.*)" should be "(.*)"$/, (token: string, id: string) => {
      expect(editLinkTxId(token)).toBe(id);
    });
  });
});

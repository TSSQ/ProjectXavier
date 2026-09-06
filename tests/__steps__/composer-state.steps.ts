import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { composerState, ComposerSignals, ComposerState } from '../../src/domain/composerState';

const feature = loadFeature(path.resolve(__dirname, '../__features__/composer-state.feature'));

const BASE: ComposerSignals = {
  pending: false,
  pendingAccount: false,
  accountFlow: false,
  noOverlay: true,
  busy: false,
  draft: '',
};

defineFeature(feature, (test) => {
  let signals: ComposerSignals;
  let state: ComposerState;

  const compute = () => {
    state = composerState(signals);
  };

  test('Idle — "+", field and camera, no Send', ({ given, then, and }) => {
    given(/^the composer is idle with an empty field$/, () => {
      signals = { ...BASE };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should show$/, () => expect(state.showPlus).toBe(true));
    and(/^the camera should show$/, () => expect(state.showCamera).toBe(true));
    and(/^Send should not show$/, () => expect(state.showSend).toBe(false));
  });

  test('Typing — camera swaps for Send, "+" stays', ({ given, then, and }) => {
    given(/^the composer is idle with the field "(.*)"$/, (draft: string) => {
      signals = { ...BASE, draft };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should show$/, () => expect(state.showPlus).toBe(true));
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should show$/, () => expect(state.showSend).toBe(true));
  });

  test('/account name step — field alone, no answer yet', ({ given, then, and }) => {
    given(/^the \/account Q&A is on the name step with an empty field$/, () => {
      signals = { ...BASE, accountFlow: true, noOverlay: false };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should not show$/, () => expect(state.showSend).toBe(false));
  });

  test('/account subtype step — a typed answer still sends', ({ given, then, and }) => {
    given(/^the \/account Q&A is on the subtype step with the field "(.*)"$/, (draft: string) => {
      signals = { ...BASE, accountFlow: true, noOverlay: false, draft };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should show$/, () => expect(state.showSend).toBe(true));
  });

  test('Draft pending — no composer at all', ({ given, then, and }) => {
    given(/^a parsed draft card is pending$/, () => {
      signals = { ...BASE, pending: true, noOverlay: false };
    });
    then(/^the composer should not be visible$/, () => {
      compute();
      expect(state.visible).toBe(false);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should not show$/, () => expect(state.showSend).toBe(false));
  });

  test('Account card pending — no composer at all', ({ given, then, and }) => {
    given(/^an account confirm card is pending$/, () => {
      signals = { ...BASE, pendingAccount: true, noOverlay: false };
    });
    then(/^the composer should not be visible$/, () => {
      compute();
      expect(state.visible).toBe(false);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should not show$/, () => expect(state.showSend).toBe(false));
  });

  test('An overlay (e.g. a query answer) hides "+" but keeps the field', ({ given, then, and }) => {
    given(/^a query-answer overlay is up with the field "(.*)"$/, (draft: string) => {
      signals = { ...BASE, noOverlay: false, draft };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^Send should show$/, () => expect(state.showSend).toBe(true));
  });

  test('Busy — "+" hides, Send stays for the in-flight submit', ({ given, then, and }) => {
    given(/^the assistant is busy with the field "(.*)"$/, (draft: string) => {
      signals = { ...BASE, busy: true, draft };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^"\+" should not show$/, () => expect(state.showPlus).toBe(false));
    and(/^Send should show$/, () => expect(state.showSend).toBe(true));
  });

  test('Busy with the field already cleared — no camera beside the spinner', ({
    given,
    then,
    and,
  }) => {
    given(/^the assistant is busy with an empty field$/, () => {
      signals = { ...BASE, busy: true, draft: '' };
    });
    then(/^the composer should be visible$/, () => {
      compute();
      expect(state.visible).toBe(true);
    });
    and(/^the camera should not show$/, () => expect(state.showCamera).toBe(false));
    and(/^Send should not show$/, () => expect(state.showSend).toBe(false));
  });
});

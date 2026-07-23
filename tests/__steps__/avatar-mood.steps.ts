import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { avatarStateFor, AssistantSignals } from '../../src/domain/avatar';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/avatar-mood.feature')
);

defineFeature(feature, (test) => {
  let signals: AssistantSignals;

  const check = (then: any) =>
    then(/^the avatar state should be "(.*)"$/, (s: string) =>
      expect(avatarStateFor(signals)).toBe(s)
    );

  test('A request in flight makes it think (even while typing)', ({ given, then }) => {
    given(/^the assistant is busy and the user is typing$/, () => {
      signals = { busy: true, typing: true };
    });
    check(then);
  });

  test('A saved entry makes it happy', ({ given, then }) => {
    given(/^the assistant just saved an entry$/, () => {
      signals = { busy: false, typing: false, lastOutcome: 'saved' };
    });
    check(then);
  });

  test('Saving an expense makes it angry', ({ given, then }) => {
    given(/^the assistant just saved an expense$/, () => {
      signals = { busy: false, typing: false, lastOutcome: 'spent' };
    });
    check(then);
  });

  test('Saving an expense while busy still thinks (busy wins)', ({ given, then }) => {
    given(/^the assistant is saving an expense while busy$/, () => {
      signals = { busy: true, typing: false, lastOutcome: 'spent' };
    });
    check(then);
  });

  test('An error makes it confused', ({ given, then }) => {
    given(/^the assistant hit an error$/, () => {
      signals = { busy: false, typing: false, lastOutcome: 'error' };
    });
    check(then);
  });

  test('A clarify outcome makes it confused', ({ given, then }) => {
    given(/^the assistant asked a clarifying question$/, () => {
      signals = { busy: false, typing: false, lastOutcome: 'clarify' };
    });
    check(then);
  });

  test('Typing a retry supersedes a lingering error reaction', ({ given, then }) => {
    given(/^the user starts typing after an error$/, () => {
      signals = { busy: false, typing: true, lastOutcome: 'error' };
    });
    check(then);
  });

  test('Typing an answer supersedes a clarify reaction', ({ given, then }) => {
    given(/^the user starts typing after a clarify prompt$/, () => {
      signals = { busy: false, typing: true, lastOutcome: 'clarify' };
    });
    check(then);
  });

  test('Typing makes it listen', ({ given, then }) => {
    given(/^the user is typing and nothing else is happening$/, () => {
      signals = { busy: false, typing: true, lastOutcome: null };
    });
    check(then);
  });

  test('At rest it is idle', ({ given, then }) => {
    given(/^nothing is happening$/, () => {
      signals = { busy: false, typing: false, lastOutcome: null };
    });
    check(then);
  });
});

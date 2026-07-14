import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  startOnboarding,
  beginAccountStep,
  advanceOnboarding,
  resolveOnboardingComplete,
  OnboardingState,
  OnboardingResult,
  OnboardingStep,
} from '../../src/domain/onboarding';

const feature = loadFeature(path.resolve(__dirname, '../__features__/onboarding.feature'));

defineFeature(feature, (test) => {
  test('First run starts at the welcome step', ({ when, then, and }) => {
    let result: OnboardingResult;

    when(/^onboarding starts$/, () => {
      result = startOnboarding();
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(result.state.step).toBe(step as OnboardingStep);
    });

    and(/^Xavier's message should mention "(.*)"$/, (text: string) => {
      expect(result.message.toLowerCase()).toContain(text.toLowerCase());
    });
  });

  test('The welcome beat hands off to the account step', ({ given, when, then }) => {
    let state: OnboardingState;
    let result: OnboardingResult;

    given(/^onboarding has started$/, () => {
      state = startOnboarding().state;
    });

    when(/^the account step begins$/, () => {
      result = beginAccountStep();
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(state.step).toBe('welcome'); // sanity: the given step didn't itself advance
      expect(result.state.step).toBe(step as OnboardingStep);
    });
  });

  test('Creating the account advances to the transaction step', ({ given, when, then, and }) => {
    let state: OnboardingState;
    let result: OnboardingResult;

    given(/^onboarding is at the "(.*)" step$/, (step: string) => {
      state = { step: step as OnboardingStep };
    });

    when(/^the account is created$/, () => {
      result = advanceOnboarding(state, 'accountCreated');
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(result.state.step).toBe(step as OnboardingStep);
    });

    and(/^Xavier's message should mention "(.*)"$/, (text: string) => {
      expect(result.message.toLowerCase()).toContain(text.toLowerCase());
    });
  });

  test(
    'Saving the first transaction advances to done and calls out the payee and category',
    ({ given, when, then, and }) => {
      let state: OnboardingState;
      let result: OnboardingResult;

      given(/^onboarding is at the "(.*)" step$/, (step: string) => {
        state = { step: step as OnboardingStep };
      });

      when(
        /^the transaction is saved with payee "(.*)" and category "(.*)"$/,
        (payee: string, category: string) => {
          result = advanceOnboarding(state, 'transactionSaved', {
            payeeName: payee,
            categoryName: category,
          });
        },
      );

      then(/^the onboarding step should be "(.*)"$/, (step: string) => {
        expect(result.state.step).toBe(step as OnboardingStep);
      });

      and(/^Xavier's message should mention "(.*)" and "(.*)"$/, (a: string, b: string) => {
        expect(result.message).toContain(a);
        expect(result.message).toContain(b);
      });
    },
  );

  test('Saving the first transaction with no payee or category still completes', ({
    given,
    when,
    then,
  }) => {
    let state: OnboardingState;
    let result: OnboardingResult;

    given(/^onboarding is at the "(.*)" step$/, (step: string) => {
      state = { step: step as OnboardingStep };
    });

    when(/^the transaction is saved with no payee or category$/, () => {
      result = advanceOnboarding(state, 'transactionSaved', {});
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(result.state.step).toBe(step as OnboardingStep);
    });
  });

  test('Skipping the tutorial from any step goes straight to done', ({ given, when, then }) => {
    let state: OnboardingState;
    let result: OnboardingResult;

    given(/^onboarding is at the "(.*)" step$/, (step: string) => {
      state = { step: step as OnboardingStep };
    });

    when(/^the tutorial is skipped$/, () => {
      result = advanceOnboarding(state, 'skipped');
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(result.state.step).toBe(step as OnboardingStep);
    });
  });

  test(
    "An event that doesn't match the current step is a no-op, and never blanks the message",
    ({ given, when, then, and }) => {
      let state: OnboardingState;
      let result: OnboardingResult;

      given(/^onboarding is at the "(.*)" step$/, (step: string) => {
        state = { step: step as OnboardingStep };
      });

      when(/^the account is created$/, () => {
        result = advanceOnboarding(state, 'accountCreated');
      });

      then(/^the onboarding step should be "(.*)"$/, (step: string) => {
        expect(result.state.step).toBe(step as OnboardingStep);
      });

      and(/^Xavier's message should not be empty$/, () => {
        expect(result.message.length).toBeGreaterThan(0);
      });
    },
  );

  test('Once done, further events are a no-op, and never blank the message', ({
    given,
    when,
    then,
    and,
  }) => {
    let state: OnboardingState;
    let result: OnboardingResult;

    given(/^onboarding is at the "(.*)" step$/, (step: string) => {
      state = { step: step as OnboardingStep };
    });

    when(/^the account is created$/, () => {
      result = advanceOnboarding(state, 'accountCreated');
    });

    then(/^the onboarding step should be "(.*)"$/, (step: string) => {
      expect(result.state.step).toBe(step as OnboardingStep);
    });

    and(/^Xavier's message should not be empty$/, () => {
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  test('The onboarding-complete flag defaults to false when unset', ({ given, when, then }) => {
    let stored: string | null;
    let resolved: boolean;

    given(/^no stored onboarding-complete preference$/, () => {
      stored = null;
    });

    when(/^the onboarding-complete preference is resolved$/, () => {
      resolved = resolveOnboardingComplete(stored);
    });

    then(/^the onboarding-complete flag should be false$/, () => {
      expect(resolved).toBe(false);
    });
  });

  test('A stored "1" resolves the onboarding-complete flag to true', ({ given, when, then }) => {
    let stored: string | null;
    let resolved: boolean;

    given(/^a stored onboarding-complete preference of "(.*)"$/, (value: string) => {
      stored = value;
    });

    when(/^the onboarding-complete preference is resolved$/, () => {
      resolved = resolveOnboardingComplete(stored);
    });

    then(/^the onboarding-complete flag should be true$/, () => {
      expect(resolved).toBe(true);
    });
  });

  test('Any other stored value resolves the onboarding-complete flag to false', ({
    given,
    when,
    then,
  }) => {
    let stored: string | null;
    let resolved: boolean;

    given(/^a stored onboarding-complete preference of "(.*)"$/, (value: string) => {
      stored = value;
    });

    when(/^the onboarding-complete preference is resolved$/, () => {
      resolved = resolveOnboardingComplete(stored);
    });

    then(/^the onboarding-complete flag should be false$/, () => {
      expect(resolved).toBe(false);
    });
  });
});

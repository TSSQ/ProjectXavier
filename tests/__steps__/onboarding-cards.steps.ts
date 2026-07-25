import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ONBOARDING_CARDS,
  OnboardingCard,
  KNOWN_ONBOARDING_VISUALS,
} from '../../src/domain/onboardingCards';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/onboarding-cards.feature')
);

defineFeature(feature, (test) => {
  test('The deck is non-empty', ({ when, then }) => {
    let deck: OnboardingCard[];

    when('I read the onboarding card deck', () => {
      deck = ONBOARDING_CARDS;
    });

    then('the deck should have between 3 and 6 cards', () => {
      expect(deck.length).toBeGreaterThanOrEqual(3);
      expect(deck.length).toBeLessThanOrEqual(6);
    });
  });

  test('Every card has a non-empty title and body', ({ when, then }) => {
    let deck: OnboardingCard[];

    when('I read the onboarding card deck', () => {
      deck = ONBOARDING_CARDS;
    });

    then('every card should have a non-empty title', () => {
      for (const card of deck) {
        expect(card.title.trim().length).toBeGreaterThan(0);
      }
    });

    then('every card should have a non-empty body', () => {
      for (const card of deck) {
        expect(card.body.trim().length).toBeGreaterThan(0);
      }
    });
  });

  test('Every card has a visual key', ({ when, then }) => {
    let deck: OnboardingCard[];

    when('I read the onboarding card deck', () => {
      deck = ONBOARDING_CARDS;
    });

    then('every card should have a non-empty visual', () => {
      for (const card of deck) {
        expect(card.visual.trim().length).toBeGreaterThan(0);
      }
    });
  });

  test("Every card's visual is one app/welcome.tsx actually maps", ({ when, then }) => {
    let deck: OnboardingCard[];

    when('I read the onboarding card deck', () => {
      deck = ONBOARDING_CARDS;
    });

    then("every card's visual should be a known, mapped visual id", () => {
      for (const card of deck) {
        expect(KNOWN_ONBOARDING_VISUALS).toContain(card.visual);
      }
    });
  });

  test("The last card is a fitting send-off", ({ when, then }) => {
    let deck: OnboardingCard[];

    when('I read the onboarding card deck', () => {
      deck = ONBOARDING_CARDS;
    });

    then(/^the last card's title should be "(.*)"$/, (title: string) => {
      const lastCard = deck[deck.length - 1]!;
      expect(lastCard.title).toBe(title);
    });
  });
});

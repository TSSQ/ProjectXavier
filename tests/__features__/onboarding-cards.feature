Feature: Welcome carousel card deck is well-formed
  The build-39 welcome carousel (app/welcome.tsx) renders an ordered deck of
  cards from src/domain/onboardingCards.ts — a pure data module so its shape
  can be checked without mounting any screen. Replaces the build-38 in-chat
  guided tutorial, which is deleted.

  Scenario: The deck is non-empty
    When I read the onboarding card deck
    Then the deck should have between 3 and 4 cards

  Scenario: Every card has a non-empty title and body
    When I read the onboarding card deck
    Then every card should have a non-empty title
    And every card should have a non-empty body

  Scenario: Every card has a visual key
    When I read the onboarding card deck
    Then every card should have a non-empty visual

  Scenario: The last card is a fitting send-off
    When I read the onboarding card deck
    Then the last card's title should be "You're set."

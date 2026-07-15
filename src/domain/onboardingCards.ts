/**
 * The welcome carousel's card deck (build 39) — pure data, no framework
 * imports, so the deck's shape can be Node-tested (tests/__features__/
 * onboarding-cards.feature). Replaces the build-38 in-chat guided tutorial
 * (src/domain/onboarding.ts, deleted): that state machine drove the REAL
 * account/transaction flows and could create actual data mid-tutorial. This
 * deck creates nothing — it's shown once, full-screen (app/welcome.tsx),
 * before the user ever touches the real app. Copy tuned from
 * docs/design/app-store-listing.md.
 */

/** Which built-in visual a card pairs with its copy — app/welcome.tsx maps
 *  each id to an actual component (the Xavier avatar for 'xavier', a Feather
 *  icon for the rest) so this module stays framework-free. */
export type OnboardingCardVisual = 'xavier' | 'privacy' | 'glance' | 'done';

export interface OnboardingCard {
  title: string;
  body: string;
  visual: OnboardingCardVisual;
}

/** Ordered deck, first card to last. The last card is the only one offering
 *  "Get Started" (app/welcome.tsx renders that from the card's position, not
 *  a per-card flag, so the deck stays plain data). */
export const ONBOARDING_CARDS: OnboardingCard[] = [
  {
    title: 'Meet Xavier — just say it.',
    body:
      'Tell me what you spent — like "lunch 12.50 at Subway" — and I\'ll track it. No forms.',
    visual: 'xavier',
  },
  {
    title: 'Private by design.',
    body:
      'No account, no cloud, no tracking. Everything you enter stays on your iPhone, encrypted. Even backups go only to your own iCloud.',
    visual: 'privacy',
  },
  {
    title: 'See it at a glance.',
    body:
      "A Home Screen widget shows this month's income and expense — and hides it when your phone is locked. Add an optional Face ID lock anytime.",
    visual: 'glance',
  },
  {
    title: "You're set.",
    body: "That's it. Add your first account and start tracking — I'll help along the way.",
    visual: 'done',
  },
];

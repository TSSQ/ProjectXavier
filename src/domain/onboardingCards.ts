/**
 * The welcome carousel's card deck — pure data, no framework imports, so the
 * deck's shape can be Node-tested (tests/__features__/onboarding-cards.feature).
 * Replaces the build-38 in-chat guided tutorial (src/domain/onboarding.ts,
 * deleted): that state machine drove the REAL account/transaction flows and
 * could create actual data mid-tutorial. This deck creates nothing — it's
 * shown once, full-screen (app/welcome.tsx), before the user ever touches the
 * real app. Copy tuned from docs/design/app-store-listing.md.
 *
 * Widened from 4 to 6 cards (phase-2 BYOK spike): the original deck predated
 * two capabilities the assistant now has and advertised neither — asking
 * plain-English questions for chart/number answers (the 'ask' card), and
 * bringing your own OpenAI/Anthropic key for sharper answers (the 'byok'
 * card). Both are new cards, not edits to the existing four, so the original
 * scenarios ("You're set." last, non-empty title/body/visual) still hold.
 */

/** Which built-in visual a card pairs with its copy — app/welcome.tsx maps
 *  each id to an actual component (the Xavier avatar for 'xavier', a Feather
 *  icon for the rest) so this module stays framework-free. */
export type OnboardingCardVisual = 'xavier' | 'ask' | 'privacy' | 'byok' | 'glance' | 'done';

/** Every visual id app/welcome.tsx's `CardVisual` actually maps to a
 *  component/icon — kept here (not re-derived from the union at runtime,
 *  which TS can't do) so the deck-shape suite can assert no card advertises
 *  an id nobody renders. Update BOTH this list and welcome.tsx's ternary
 *  together when adding a new visual. */
export const KNOWN_ONBOARDING_VISUALS: OnboardingCardVisual[] = [
  'xavier',
  'ask',
  'privacy',
  'byok',
  'glance',
  'done',
];

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
      'Tell me what you spent — like "lunch 12.50 at Subway" — and I\'ll track it. Manage accounts the same way: "open a savings account", "rename my wallet to Travel". No forms.',
    visual: 'xavier',
  },
  {
    title: "Ask, and I'll show you.",
    body:
      'Try "where did my money go" or "how much did I spend on dining last month" — I\'ll answer with a chart or a number, straight from your data.',
    visual: 'ask',
  },
  {
    title: 'Private by design.',
    body:
      'No account, no cloud, no tracking. Everything you enter stays on your iPhone, encrypted. Even backups go only to your own iCloud.',
    visual: 'privacy',
  },
  {
    title: 'Bring your own key — optional.',
    body:
      "Xavier already works free, with no account, cloud, or key needed. Want sharper answers? Add your own OpenAI or Anthropic key in Settings — your questions go straight from your phone to that provider, who bills you directly. Xavier never sees your key or your data.",
    visual: 'byok',
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

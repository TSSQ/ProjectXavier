/**
 * The "What can I ask?" example prompts — pure data, no framework imports, so
 * the deck's shape (and, more importantly, that every advertised phrase
 * actually routes the way its group claims) can be Node-tested
 * (tests/__features__/assistant-examples.feature,
 * tests/__steps__/assistant-examples-routing.steps.ts).
 *
 * Grouped, tappable examples shown by AssistantExamplesSheet
 * (src/components/ui/AssistantExamplesSheet.tsx), reached from the assistant
 * home screen's "All commands" popover (app/(tabs)/index.tsx) — the ONE
 * obvious way in, alongside /account and /transactions. Tapping an example
 * PREFILLS the composer with `text` and focuses it; it never auto-sends, so
 * the user still reviews and taps Send themselves, same discipline as every
 * other confirm-before-write surface in this app.
 *
 * Three groups, each proven (by the routing suite) to land where it claims
 * via the SAME unified gate `runParse` uses (src/domain/intentGate.ts):
 *  - "Track an expense" — ordinary expense utterances that must fall THROUGH
 *    every gate (`detectIntent` -> null) to the expense parser, not be
 *    swallowed by the query or account gate.
 *  - "Ask about your money" — question/report shapes that must classify as
 *    `detectIntent` -> 'query'. These are the same four canonical examples
 *    the assistant's onboarding/marketing copy already leans on ("where did
 *    my money go" -> a category donut, "how much did I spend on dining last
 *    month" -> a total, "show my spending trend", "who do I pay the most").
 *    Not every one of these resolves via the no-engine floor
 *    (src/domain/queryFloor.ts's `resolveFloorQueryCall`) — the floor
 *    deliberately stands aside on trend/average questions and doesn't cover
 *    "top payee" at all (see queryFloor.ts's header) — those two are answered
 *    by the on-device/BYOK tool-selection tiers instead. What's guaranteed
 *    here is narrower but load-bearing: the query GATE always recognises
 *    them, so they're never mis-swallowed as an expense or account command.
 *  - "Manage accounts" — create/update (rename/retype/rebalance) utterances
 *    that must classify as the specific `detectIntent` op the label claims.
 *    Delete is deliberately NOT advertised here: chat only ever hands delete
 *    off to the Accounts screen (src/domain/accountDeleteHandoff.ts), it
 *    never executes it, so there's no "type this and it's deleted" phrase to
 *    honestly offer.
 */

export interface AssistantExample {
  /** Shown in the sheet — a short, human description of the example. */
  label: string;
  /** What gets PREFILLED into the composer when this example is tapped. */
  text: string;
}

export interface AssistantExampleGroup {
  title: string;
  examples: AssistantExample[];
}

export const ASSISTANT_EXAMPLE_GROUPS: AssistantExampleGroup[] = [
  {
    title: 'Track an expense',
    examples: [
      { label: 'A quick lunch', text: 'lunch 12.50 at Subway' },
      { label: 'Paying someone back', text: 'paid Alex 20 for dinner' },
      { label: 'A grocery run', text: '85.40 groceries at NTUC' },
    ],
  },
  {
    title: 'Ask about your money',
    examples: [
      { label: 'Where did my money go?', text: 'where did my money go' },
      {
        label: 'Dining spend last month',
        text: 'how much did I spend on dining last month',
      },
      { label: 'My spending trend', text: 'show my spending trend' },
      { label: 'Who I pay the most', text: 'who do I pay the most' },
    ],
  },
  {
    title: 'Manage accounts',
    examples: [
      { label: 'Open a new account', text: 'open a savings account' },
      { label: 'Rename an account', text: 'rename my wallet to Travel' },
      { label: 'Retype an account', text: 'change my wallet to a credit card' },
      { label: 'Update a balance', text: 'set OCBC balance to 5000' },
    ],
  },
];

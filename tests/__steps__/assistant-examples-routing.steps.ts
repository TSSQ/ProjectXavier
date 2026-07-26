/**
 * The valuable assistant-examples check (phase-2 BYOK spike): every phrase
 * ASSISTANT_EXAMPLE_GROUPS (src/domain/assistantExamples.ts) advertises in
 * the "What can I ask?" sheet must actually route the way its group claims —
 * driven through the SAME unified gate `runParse` uses
 * (src/domain/intentGate.ts's `detectIntent`), a plain jest suite mirroring
 * tests/__steps__/intent-corpus.steps.ts's own "drive the real gate, not a
 * mock" discipline. This guarantees we never advertise a phrase the app
 * would silently swallow into the wrong flow.
 *
 *  - "Track an expense" examples must classify as `null` — i.e. fall THROUGH
 *    every gate to the expense parser, not be swallowed by the query or
 *    account gate.
 *  - "Ask about your money" examples must classify as `'query'`. Also runs
 *    each through `resolveFloorQueryCall` (src/domain/queryFloor.ts) as an
 *    informational sanity check — NOT a hard requirement that every example
 *    resolves on the no-engine floor, since that floor deliberately stands
 *    aside on trend/average questions and has no "top payee" tool at all
 *    (queryFloor.ts's own header); those are answered by the on-device/BYOK
 *    tool-selection tiers instead. When the floor DOES claim a tool, the
 *    returned tool name must be a real one.
 *  - "Manage accounts" examples must classify as the SPECIFIC op (create vs.
 *    update) its label claims — see `MANAGE_ACCOUNT_EXPECTED_OP` below.
 */
import { detectIntent } from '../../src/domain/intentGate';
import { resolveFloorQueryCall } from '../../src/domain/queryFloor';
import { QUERY_TOOL_NAMES } from '../../src/domain/queryTools';
import { ASSISTANT_EXAMPLE_GROUPS } from '../../src/domain/assistantExamples';

const NOW = Date.parse('2026-07-20T12:00:00Z');

function groupByTitle(title: string) {
  const group = ASSISTANT_EXAMPLE_GROUPS.find((g) => g.title === title);
  if (!group) throw new Error(`No "${title}" group in ASSISTANT_EXAMPLE_GROUPS`);
  return group;
}

describe('assistant examples — "Track an expense" falls through every gate', () => {
  const group = groupByTitle('Track an expense');

  it('has at least one example', () => {
    expect(group.examples.length).toBeGreaterThan(0);
  });

  it.each(group.examples.map((e) => [e.label, e.text] as const))(
    '%s ("%s") -> null (expense ladder)',
    (_label, text) => {
      expect(detectIntent(text)).toBeNull();
    }
  );
});

describe('assistant examples — "Ask about your money" always hits the query gate', () => {
  const group = groupByTitle('Ask about your money');

  it('has at least one example', () => {
    expect(group.examples.length).toBeGreaterThan(0);
  });

  it.each(group.examples.map((e) => [e.label, e.text] as const))(
    '%s ("%s") -> query',
    (_label, text) => {
      expect(detectIntent(text)).toBe('query');

      // Informational only — see the module header for why a `null` here is
      // NOT a failure (the floor deliberately stands aside on some shapes).
      const floorCall = resolveFloorQueryCall(text, NOW);
      if (floorCall) {
        expect(QUERY_TOOL_NAMES).toContain(floorCall.tool);
      }
    }
  );
});

describe('assistant examples — "Manage accounts" hits the exact op claimed', () => {
  const group = groupByTitle('Manage accounts');

  // Every current example is create or update — delete is deliberately never
  // advertised here (chat only ever hands delete off to the Accounts screen,
  // src/domain/accountDeleteHandoff.ts; it never executes it).
  const MANAGE_ACCOUNT_EXPECTED_OP: Record<string, 'create' | 'update'> = {
    'Open a new account': 'create',
    'Rename an account': 'update',
    'Retype an account': 'update',
    'Update a balance': 'update',
  };

  it('has an expected op for every example in the deck', () => {
    for (const example of group.examples) {
      expect(MANAGE_ACCOUNT_EXPECTED_OP[example.label]).toBeDefined();
    }
  });

  it.each(group.examples.map((e) => [e.label, e.text] as const))(
    '%s ("%s") -> the expected account op',
    (label, text) => {
      const expected = MANAGE_ACCOUNT_EXPECTED_OP[label];
      expect(detectIntent(text)).toBe(expected);
    }
  );
});

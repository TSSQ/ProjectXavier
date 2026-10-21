# Package D: asking intents ("how much did I spend on food") — handoff (2026-10-21)

The 2026-10-10 parse-quality effort covered logging only. The question path
("Ask Xavier") was untouched except temperature 0 on the BYOK query loop and
14 intent-corpus cases. This package brings the question path to the same
standard: measured, resolving the user's own vocabulary, and learning from
corrections.

## How questions work today (origin/main)
1. `detectQueryIntent` (`src/domain/queryIntent.ts`), a deterministic gate,
   decides the text is a question (interrogative lead etc.). Corpus:
   `tests/intent-corpus.jsonl` (297 lines, 57 query), `evals-lite/intent-report.mjs`.
2. Tool selection, one of seven tools (`src/domain/queryToolNames.ts`): on-device
   FM via `buildQueryToolSelectionInstructions` / `deviceParseQuerySelection`
   (`src/domain/queryToolSelection.ts`, user turn is just `Question: <text>`,
   no grounding lists), or the BYOK query loop (`src/features/ai/queryLoop.ts`,
   `src/domain/queryLoopPrompt.ts`, provider-native tool calling), else the
   regex floor `resolveFloorQueryCall` (`src/domain/queryFloor.ts`).
3. The period is always overridden by code (`periodRange.ts`
   `resolvePeriodFromText`).
4. `executeQueryTool` (`src/domain/queryTools.ts`) resolves `category` /
   `payee` / `account` names and computes the answer; `queryAnswerCard` renders
   it (`src/components/assistant/AnswerCard.tsx`); `recordParse` logs the engine.
5. Deterministic corpus for the floor: `tests/query-corpus.jsonl` (59 lines),
   `evals-lite/query-report.mjs`, 100% bar. Spec: `docs/design/ask-xavier-queries-spec.md`.

## Known weaknesses (verified in code)
- **Exact-match-only filters.** `resolveCategory` in `queryTools.ts` (~line 252)
  uses `findCategoryMatch(...).exact` only. "food" against categories
  {Dining, Groceries} does not resolve, so `total_spent` answers with the
  total of ALL spending plus a note "couldn't find category "food" — showing
  all". Same for payees ("mcd" vs "McDonald's") and accounts. There is no
  synonym table, no fuzzy "did you mean", no multi-category union, no learning.
- **No model-level measurement.** Only the gate and the floor are measured, at
  a 100% deterministic bar. Nothing measures how often the on-device model or
  the cloud loop picks the right tool / period / filters, nor whether the
  final number is right. This is the gap the logging path had before its eval
  harness, and where its gains came from.
- **Gate recall on terse questions is unmeasured.** "food this month?",
  "how much on grab", "total oct", "spent on food?" may fall to the expense
  parser and get logged as a transaction (the costly error).
- **No feedback loop.** Phrase memory, learned defaults and correction capture
  are all on the transaction draft. A wrong answer teaches nothing and is not
  captured anywhere.
- **The on-device selection prompt never sees the user's category names**, by
  design ("re-resolved downstream"), which only works if downstream resolution
  is good (it is not, see above). The cloud loop's tool schema takes free
  text for `category`.

## Work packages (two sessions, Opus 5.5)

### Session D-A: resolution and feedback (owns `queryTools.ts`, `AnswerCard.tsx`,
the query block of `app/(tabs)/index.tsx`, `phraseMemory.ts`, corrections)

**D1 (P0): resolve the user's own vocabulary.**
- Replace exact-only resolution in `resolveCategory` / `resolvePayee` /
  `resolveAccount` with a ladder, pure and BDD-tested in a new
  `src/domain/queryFilterResolution.ts`: (1) exact; (2) the user's learned
  term memory (below); (3) fuzzy via `findCategoryMatch(...).suggestion` and
  `findPayeeMatch` (typo + whole-word variant); (4) a small built-in synonym
  table keyed by concept (food → dining, groceries, restaurants, eating out,
  food & drink, meals; transport → transit, grab, taxi, mrt, bus, petrol,
  gas; shopping → clothes, zalora, amazon …; bills → utilities, phone,
  internet; health → medical, pharmacy, dental; entertainment → movies,
  netflix, games) matched against the user's category names and kinds;
  (5) a multi-category union when more than one of the user's categories
  matches (sum Dining + Groceries, and say so). Only when all fail: the
  honest "couldn't find" note. Payees also use the 3+ letter shared-word
  rule from `groundingSelection.ts`.
- Answer card: show what was included ("Dining + Groceries, this month"),
  and "did you mean" chips when the match was fuzzy or a synonym; tapping a
  chip re-runs the tool with that filter and teaches the term memory.
- Term memory: a `q:` keyed entry in `phrase_memory` (or a sibling table if
  the shape does not fit) mapping the user's word → category/payee/account
  ids, written on chip taps and on corrections; applied silently next time
  with "as last time" on the card; two reverts delete it. Backup round-trip.

**D3 (P1): answer feedback loop.**
- "Wrong answer" on the answer card: chips to pick the right tool (from the
  seven), period, and category/payee; re-runs; writes a `question` kind case
  into the corrections file (`src/domain/parseCorrection.ts` shape extended:
  question text, engine, chosen call, resolved filters, user's correction,
  the context's category/payee/account names) gated on `METRICS_ENABLED`,
  and teaches term memory.
- Metrics: per engine, question count, wrong-answer rate, which dimension
  was wrong (tool / period / filter); add to the developer screen block.
- `evals/corrections/fold.mjs` folds `question` cases into the question
  dataset (D2), not the expense one; same redaction rules.

### Session D-B: measurement and contract (owns `evals/`, `tests/*corpus*`,
`queryIntent.ts`, `queryFloor.ts`, `queryToolSelection.ts`, `queryLoopPrompt.ts`,
`queryLoop.ts`)

**D2 (P0): a question eval harness.**
- `evals/questions.jsonl`: 150+ hand-labelled questions in realistic terse
  and full styles (Singapore context like the expense set): tool, period
  spec (token or explicit month/year), expected filter resolution against a
  given context (categories with kinds, payees, accounts), and an expected
  numeric answer computed from a fixed synthetic ledger fixture
  (`evals/questions-ledger.json`, ~200 transactions) so "answerCorrect" is
  scorable end to end. Include 30+ `expected: expense` / `expected: refuse`
  near-misses so gate precision and recall are both measured ("did I pay
  1500 rent" is a question; "paid 1500 rent" is a log). Split dev/holdout
  with `evals/split.mjs` conventions.
- Runner: extend `evals/run-eval.mjs` (or a sibling `evals/run-questions.mjs`)
  with engines `gate` (detectQueryIntent), `floor`, `fm` (the probe, see
  below), `anthropic`, `openai` (real `runAnthropicQueryLoop` /
  `runOpenAiQueryLoop` with mocked `executeTool` over the fixture), scoring
  tool / period / filters / answer, per-axis, same result artifact shape and
  README conventions as the expense eval; a `npm run eval:questions` JS gate
  (gate + floor, deterministic, 100% bar) and `eval:questions:cloud`.
- The FM probe (`evals/fm/probe`, Swift) runs the expense schema; check
  whether it can take the query-selection schema/instructions. If a Swift
  change is needed, write it and the Node driver but flag that it compiles
  and runs only on the owner's Mac.
- Fix gate recall/precision gaps the dataset exposes in `queryIntent.ts`
  (corpus case first, then the pattern, per the spec's rule), and floor
  gaps in `queryFloor.ts`. Reseed baselines honestly.

**D4 (P1): contract improvements, measured by D2.**
- Cloud loop: make the `category` / `payee` / `account` tool parameters a
  closed choice of the user's own names (capped via `selectGroundingEntities`)
  plus an "unspecified" value, so the model picks a real entity; keep the
  free-text fallback for the floor. Measure with `eval:questions:cloud`.
- On-device: an A/B on the probe, with vs without a capped "Known
  categories:" line in `buildQueryToolSelectionPrompt`. Wording changes to
  the FM instructions need the safety screen on a Mac; prefer the user-turn
  line over instruction changes. Keep whichever measures better; do not
  merge an input change without a dev run on the Mac.

## Constraints (same as the logging packages)
Cloud sessions have no Mac (no FM probe) and may have no provider keys; say
in every PR what was not measured. Never log a key or body. `src/domain/**`
framework-free, zod at every boundary, parameterised SQL, backup round-trip
for any new table. No prompt-wording change to FM instructions without a
Mac safety screen. Precision over recall at the gate: a question logged as
an expense is the costly error.

## Owner (Mac) steps once PRs are up
1. Run `npm run eval:questions:fm` (new) on dev for the FM tool-selection
   baseline; commit artifacts.
2. Run `eval:questions:cloud` with keys for the Haiku 5.5 / gpt-4.1-mini
   baseline; commit.
3. After D4: re-run both; one holdout look on the question set.

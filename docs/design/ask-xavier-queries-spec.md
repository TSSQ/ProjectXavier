# Spec: Ask-Xavier queries (read-only tool belt + charts) + eval-driven intent gate

**Branch:** `claude/phase2-byok` · **Status:** design · 2026-07-24
**Supersedes** the parked deterministic-router-only query design (memory
`ask-xavier-query-feature`) with a tool-belt architecture; **builds on** the
parse/create/update infrastructure (ParseContract, engines, gate, chat cards).

## 1. Objective

Let the user ask Xavier questions about their own data — "how much did I spend
on dining last month", "total income this year", "where did my money go",
"show my spending trend" — and get a **deterministic, chart-rendered answer**
in chat, across all engines (BYOK OpenAI/Anthropic, on-device FM, and a
no-engine floor).

Two workstreams, shipped together:
- **A. Eval-driven intent gate** — convert the hand-rolled gate development
  loop to a labeled-corpus discipline BEFORE adding the query intent (the
  reviewer's explicit warning: the rules are at the edge of what hand-tuning
  carries; this feature adds a fourth intent class).
- **B. The query feature** — read-only tool belt + per-engine ladder + chart
  cards.

## 2. Doctrine (unchanged, now load-bearing for queries)

**The model plans; deterministic code computes; the app renders.**
- The model only ever SELECTS a tool and FILLS enum/string parameters.
- Every number on screen comes from a deterministic tool result (domain
  functions over Drizzle/parameterised SQL), NEVER from model prose.
- Dates/periods are deterministic: the model emits period TOKENS
  (`this_month | last_month | this_week | last_week | this_year | last_year |
  all_time`), a pure resolver turns tokens into epoch ranges. The model never
  produces a date string.
- **Read-only**: no write tools in v1. A wrong tool pick is a wrong answer the
  user re-asks — zero destructive risk, so no confirm cards.
- Model output is untrusted → zod at the boundary (guardrail #6). SQL stays
  parameterised (#4). No new endpoints (#3): BYOK loops call the user's own
  provider key directly, as the parse engines already do.

## 3. What exists (assemble, don't invent)

- **Charts**: `src/components/ui/{BarChart,DonutChart,MultiLineChart,Sparkline}.tsx`
  already power the dashboard — chat cards feed the SAME components.
- **Aggregates**: `src/domain/balances.ts` (netWorth, balanceSeries,
  accountPeriodBalances, signedDelta…) and the transactions repository provide
  the math; tools are thin wrappers.
- **Engines**: the raw-fetch BYOK engines + `ParseContract` generalization;
  FM via `generateObject({ model: apple(), schema })` (proven on 3 contracts).
- **Gate**: `src/domain/accountIntent.ts` decides create/update/delete/null;
  queries add a 4th domain, decided BEFORE the account gate in `runParse`.
- **Date resolution**: `resolveRelativeDate`/`resolveAbsoluteDate` patterns to
  mirror for the new period resolver.

## 4. Workstream A — eval-driven intent gate (DO FIRST)

The gate is deterministic, so its "eval" is a **corpus where every case must
pass** (a 100% bar, not a statistical threshold). The discipline changes from
"argue about regexes" to "add labeled cases, run, see what breaks".

1. **`tests/intent-corpus.jsonl`** (NEW) — one labeled case per line:
   `{ "text": "...", "expect": "create|update|delete|query|null",
      "note": "why / which rework round found it" }`.
   Seed it by PORTING the collision knowledge from the existing feature files
   (account-intent, account-intent-ops — the ~150 cases from 5 adversarial
   rounds: government rule, attributive nouns, bare-new anchor,
   clause-prepositions, 'on'-boundary, op-discrimination) PLUS a new
   query-intent section (§5.1's shapes + query/expense/account collisions).
   Existing feature files stay as-is (they keep passing); the corpus is the
   single GROWING dataset going forward.
2. **`tests/__steps__/intent-corpus.steps.ts`** (or a plain jest suite) —
   iterates every corpus line through the unified gate; any mismatch fails
   with the case's `note`. This runs in `npm test` like everything else.
3. **`npm run eval:intent`** — a small script (`evals-lite/intent-report.mjs`
   or similar) that prints a per-class coverage/accuracy table (create N/N,
   update N/N, …) for humans; exits non-zero on any failure. This is the
   "eval" surface future gate changes must keep green.
4. **Rule going forward** (document in the gate's header): no gate change
   lands without corpus cases for the new behavior added FIRST.

## 5. Workstream B — the query feature

### 5.1 Query gate (deterministic, `src/domain/queryIntent.ts` NEW)
`detectQueryIntent(text): { } | null` — a question/report shape:
- interrogative lead (`how much | how many | what('s) | when | which | who`) OR
  report verbs (`show (me) | list | compare | chart | graph | breakdown`) OR
  keyword shapes (`total/sum/average + spent/spend/spending/income/earned`,
  `net worth`, `balance history`).
- MUST NOT swallow expenses or account-ops: "spent 20 on lunch" (amount-first →
  expense), "show my accounts" is fine as a query, but "add/rename/delete…"
  keeps routing to the account gate. Runs BEFORE `detectAccountIntent` in
  `runParse`; explicit `/transactions` (forceExpense) still bypasses everything.
- All boundary cases go into the intent corpus (workstream A), not ad-hoc tests.

### 5.2 Tool belt (`src/domain/queryTools.ts` NEW — pure, framework-free)
Seven read-only tools; each = zod param schema + pure executor over
already-loaded data (accounts, transactions, categories, payees — the caller
loads once, same as parse grounding):

| tool | params | returns |
|---|---|---|
| `total_spent` | period, category?, payee?, account? | `{ amountMinor, count }` |
| `total_income` | period, category? | `{ amountMinor, count }` |
| `spending_by_category` | period | `{ slices: [{name, amountMinor}] }` |
| `spending_over_time` | period, granularity(day\|week\|month), category? | `{ series: [{label, amountMinor}] }` |
| `top_payees` | period, n(≤10) | `{ rows: [{name, amountMinor, count}] }` |
| `net_worth` | asOf?: period-end \| series?: bool | `{ amountMinor }` or `{ series }` |
| `search_transactions` | period, category?, payee?, account?, limit(≤20) | `{ rows: [...] }` |

- `period` is the token enum (§2); `resolvePeriodRange(token, now)` in a new
  `src/domain/periodRange.ts` (pure, TZ-safe, mirrors the existing date
  resolver conventions; `now` injected, never `Date.now()` inside).
- Category/payee/account params are NAME STRINGS re-resolved through the
  existing matchers (`findCategoryMatch`/`findPayeeMatch`/`findAccountMatch`)
  — a model-invented name that doesn't resolve → the tool runs UNFILTERED and
  the card says so ("couldn't find 'X', showing all") rather than silently
  returning zero.
- Executors reuse `balances.ts`/domain logic where it exists; all pure, all
  BDD-tested with fixture data.

### 5.3 Per-engine ladder (mirrors the parse ladder; `routeEngines` order)
- **BYOK (OpenAI/Anthropic): multi-round tool loop** over the SAME raw-fetch
  engines — provider-native tool use (Anthropic `tools` + `tool_result`
  messages; OpenAI `tools` + `tool_calls`), capped at **3 rounds**, then a
  final narration turn. Enables composition ("compare dining this month vs
  last" = two `total_spent` calls). New `src/features/ai/queryLoop.ts` with the
  same hygiene as the engines: AbortController timeout per round, never
  throws (null → fall through), never logs key/body.
- **FM: single-shot structured tool selection** via
  `generateObject({ model: apple(), schema: toolSelectionSchema })` — a zod
  schema of `{ tool: enum(7), params: {...} }` — the EXACT proven pattern
  (create/update contracts). One tool per question; no chaining. A refusal or
  unusable output falls through to the floor.
- **Floor (no engine): canned deterministic patterns** for the top shapes —
  "spent this month/last month (+ optional category word)", "income",
  "net worth", "breakdown" — regex-level parse straight to a tool call. A gate
  hit that no tier can serve answers honestly ("I can answer things like…"),
  never a confused face.

### 5.4 Chat answer cards (`src/components/assistant/` NEW)
Tool results render as data cards; the model's prose (BYOK only) is a caption
UNDER the card, clearly secondary:
- `StatCard` (total_spent/total_income/net_worth point value — big number via
  the existing currency formatter),
- `BreakdownCard` (spending_by_category → `DonutChart` + legend),
- `TrendCard` (spending_over_time / net_worth series → `BarChart` /
  `MultiLineChart`),
- `RankListCard` (top_payees), `TxListCard` (search_transactions, reusing the
  transaction row component).
Numbers on cards are formatted from tool results ONLY. FM/floor answers get a
deterministic one-line caption template (no model prose at all).

### 5.5 Metrics + privacy copy
- Extend the parse metric with `intent: 'query'`, engine, tool name, outcome
  (`answered | no_match | fell_through`) — counts/buckets only, no query text.
- BYOK settings copy: "your questions and the summary figures needed to answer
  them are sent to <provider> using your key" (was: "the text you enter").

## 6. Out of scope (v1)
Write tools of any kind; multi-turn conversational memory; FM native tool-loop
(future — the binding exposes it, revisit after a probe); free-form date ranges
("between March and May" — falls to the closest token or asks); eval-harness
scoring of tool selection (deferred like the other features, harness lives on
`claude/parse-eval`).

## 7. Acceptance criteria (plain-Node BDD unless stated)
1. **Corpus**: every intent-corpus case passes; `npm run eval:intent` prints
   the per-class table and exits 0; the ported account-gate knowledge (≥100
   cases) + ≥40 new query cases (incl. query/expense collisions: "spent 20 on
   lunch"→expense, "how much did I spend on lunch"→query, "show me the money"
   →decide+document, "add up my dining"→query) are present.
2. **periodRange**: token → correct epoch range for a fixed injected `now`,
   TZ-pinned tests (mirror the jest TZ convention).
3. **Tools**: each of the 7 executors correct on fixture data (incl. transfer
   exclusion from spend/income — transfers are neither); unresolvable name →
   unfiltered + flagged, never silent-zero.
4. **FM selection contract**: zod-validated; hallucinated tool name/params
   rejected → falls through; number-free (schema has no amount fields).
5. **BYOK loop**: fetch-mocked tests — respects 3-round cap, threads
   tool_result correctly per provider wire format, timeout/abort → null,
   never leaks key in any log; wire-format regression test like the expense
   one (tool names/schemas exact).
6. **Floor**: the canned shapes answer with zero engines configured.
7. **Routing**: query gate runs before the account gate; all existing suites
   (795) stay green; `/transactions` bypass intact.
8. Manual on-device: one chart card renders from each of FM and BYOK; the
   metric records the engine+tool.

## 8. Files
NEW: `src/domain/{queryIntent,queryTools,periodRange,queryToolSelection}.ts`,
`src/features/ai/queryLoop.ts`, `src/components/assistant/*Card.tsx`,
`tests/intent-corpus.jsonl` + steps, `evals-lite/intent-report.mjs`,
feature/step pairs for §7.
CHANGED: `app/(tabs)/index.tsx` (query branch in runParse + card rendering),
`engines/shared.ts` (query tool wire shapes), `deviceParse.ts` (selection
call), `parseMetrics.ts`, BYOK settings copy, gate header (corpus rule).

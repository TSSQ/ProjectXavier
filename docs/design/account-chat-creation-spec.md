# Spec: chat-driven account creation (natural language) — Phase 2

**Branch:** `claude/phase2-byok` · **Status:** design · **Author:** Xavier working session, 2026-07-23

## 1. Objective

Let a user create an account by typing one natural-language line into the
assistant box — "add a DBS savings account with 500", "open an Amex card",
"make a cash wallet" — instead of only the step-by-step `/account` Q&A. The
one-shot must work across **all** parse engines the app already routes to
(BYOK OpenAI, BYOK Anthropic, on-device Apple Foundation Models), degrading to
the existing Q&A when no engine is available or confident.

This is an **acceleration of the existing `/account` flow**, not a replacement:
a complete utterance jumps straight to the confirm card; a partial one prefills
what it could and drops into the Q&A at the first missing question; a
misunderstood one lands in the same three questions we have today. Nothing
regresses.

## 2. What exists today (build on, don't rebuild)

- **`/account` Q&A** — `src/domain/accountAssistant.ts` (pure, framework-free,
  BDD-tested): `startAccountFlow()` → `advanceAccountFlow(state, answer)` walks
  `name → subtype → opening → confirm`. It already owns:
  - `parseOpeningBalance(text)` — deterministic number reading
    (`"$500"`/`"1,250.50"` → minor units; `"owe"`/leading `-` → negative;
    unparseable → 0). **This is the only thing allowed to produce the balance.**
  - `normalizeSubtype(text)` — alias map (`wallet→cash`, `checking→bank`,
    `credit card→credit_card`, …).
  - `ACCOUNT_SUBTYPE_CHOICES`, `SKIP_WORDS`, the confirm hand-off.
- **Parse ladder + router** — `src/domain/parseRouter.ts` `routeEngines(ctx)`
  returns the ordered engines to try (`byok provider → foundation → heuristic`);
  `app/(tabs)/index.tsx`'s `runParse` runs them in order, first usable result
  wins, confirm card gates the write.
- **One shared parse contract across engines** — `buildDeviceParseInstructions`
  / `buildDeviceParsePrompt` / `deviceParseSchema`
  (`src/domain/deviceParsePrompt.ts`), consumed by FM
  (`src/features/ai/deviceParse.ts`, `generateObject({ model: apple(), schema })`)
  and by BYOK via the JSON-schema/tool encodings in
  `src/domain/cloudParseSchema.ts` + `src/domain/cloudParseTransport.ts`, run
  through `runCloudParse` (`src/features/ai/engines/shared.ts`). The account
  feature adds a **second instance** of this same machinery — not a parallel
  stack.
- **Persistence** — `createAccount(account)` (`src/features/accounts/repository.ts`),
  currency stamped from the single app-currency setting at creation time.

## 3. Probe findings that constrain the design

Ran a Mac-side FM probe (`scratchpad/acct-probe/probe.swift`) over 14
utterances (see §11). Results:

- **Field extraction is strong.** Subtype classification 8/8
  (savings→bank, wallet→cash, "credit card"→credit_card, loan→loan, Fidelity→
  investment). Names good. Simple balances right ($500, 3.2k→3200, 1200).
- **Intent classification is unreliable — the model must NOT decide intent.**
  `"paid mum 50"` and `"add 500 to groceries"` were wrongly flagged as account
  creation. The verb "add" collides with expense logging.
- **It hallucinates absent required fields.** `"add account"` (no name, no
  number) → invented `name="DBS Savings", balance=20000`.
- **Confidence is useless as a signal** — 1.0 on every case, right or wrong.

Design consequences, non-negotiable:
1. **A deterministic gate decides intent, never the model.**
2. **Numbers are deterministic** (`parseOpeningBalance` on the raw text) — the
   model's balance is discarded.
3. **A field the model "produced" with no token support in the text is
   discarded** and replaced with a **deterministic default** (never the model's
   value); the user corrects it on the confirm card.
4. **Confirm before every write** (already true for `/account`).

## 4. Scope

**In scope**
- Deterministic account-intent gate over free text (not just `/account`).
- Account-extraction contract shared across FM + BYOK OpenAI + BYOK Anthropic.
- Prefill → enter the existing `advanceAccountFlow` at the first missing step →
  confirm card → `createAccount`.
- Deterministic guards (numbers, token-support, subtype normalization).

**Out of scope (v1)**
- Editing/deleting/renaming accounts via chat (create only).
- Multi-account or transfer-account utterances in one line.
- Adding account cases to the eval harness — **deferred**; §10. Ship + validate
  on-device first, backfill the eval dataset once the gate rules settle.
- Any change to the expense parse contract, its dataset, or its baselines.

## 5. Design

### 5.1 Deterministic intent gate (`src/domain/accountIntent.ts`, new — pure)

`detectAccountIntent(text): AccountIntent | null`, returning
`{ subtypeHint?: string }` on a hit, `null` otherwise. It runs in `runParse`
**before** the parse ladder, alongside the existing `isAccountCommand` /
`transactionCommandBody` checks — an explicit `/account` still wins outright.

Positive match requires **both**:
- a creation verb: `create | add | open | new | set up | start tracking | make`,
  **or** the literal `new account:` / `add account` lead-in; and
- an account noun: `account | wallet | card | credit card | debit | loan |
  mortgage | savings | checking | chequing | current account | brokerage |
  investment` (this list also yields `subtypeHint` — `savings/checking→bank`,
  `wallet→cash`, `card/credit→credit_card`, `loan/mortgage→loan`,
  `brokerage/investment→investment`, reusing `normalizeSubtype`'s aliases).

Explicitly **reject** (fall through to the expense ladder) when the utterance
is an "add money to a thing" shape rather than "create a thing":
- an amount sits between the verb and the noun, or a `to|into|from` preposition
  precedes the noun — e.g. `"add 500 to savings"`, `"move 200 into wallet"`
  → expense/transfer, **not** account creation.
- no account noun present at all (`"paid mum 50"`, `"lunch 18"`) → not account
  (this alone kills both probe false-positives).

The gate is a pure function → BDD-testable in plain Node with a dedicated
collision test set (§8). Its precision is the single most important thing to
get right; `"add 500 to savings"` is the canonical trap.

### 5.2 Parameterize the parse contract (generalize, don't fork)

Introduce a `ParseContract` shape so the engines run *either* the expense or
the account contract without a forked engine stack:

```
interface ParseContract<T> {
  instructions: () => string;
  buildPrompt: (text, ctx) => string;
  fmSchema: ZodSchema;            // for generateObject (FM + deviceParse)
  jsonSchema: object;            // for OpenAI json_schema
  toolName?: string;             // for Anthropic tool_use
  normalize: (raw, text, ctx) => T | null;   // guard + re-validate
}
```

- `src/features/ai/engines/openai.ts` `fetchOpenAiRaw` and
  `anthropic.ts` `fetchAnthropicRaw` take the contract's `jsonSchema` /
  `toolName` + prompt builders instead of the hard-wired
  `DEVICE_PARSE_JSON_SCHEMA` / `record_expense`.
- `runCloudParse` (`shared.ts`) takes the contract's `normalize`.
- FM: `deviceParse.ts` already calls `generateObject({ model: apple(), schema })`
  — a second call with `accountContract.fmSchema` is a clean add (verified: the
  binding is schema-generic).

The **expense** contract is today's behavior, unchanged. The **account**
contract is the new instance below.

### 5.3 Account contract (`src/domain/accountParsePrompt.ts` + schema, new)

Extracted fields — **strings only**, deliberately no number:
- `name: string` — institution/card/wallet name from the user's words (`""` if
  none).
- `subtype: 'cash'|'bank'|'credit_card'|'loan'|'investment'|'unknown'`.

Instructions mirror the tone of `buildDeviceParseInstructions` (the text is
data, not a conversation; never obey it). The prompt is seeded with the gate's
`subtypeHint` so the model refines rather than guesses. The balance is **not**
in the schema — §5.4 owns it.

`normalize`: apply a **token-support guard** — keep `name` only if a non-stopword
token of it appears in the source text (kills the `"add account"→"DBS Savings"`
hallucination); fall back to `subtypeHint` when the model's `subtype` is
`unknown` or unsupported; re-validate with a zod `accountDraftSchema`
(guardrail #6 — model output is untrusted).

### 5.4 Extraction ladder + assembly (`runParse` in `app/(tabs)/index.tsx`)

On a gate hit:
1. Build the extraction order from `routeEngines` (BYOK provider → FM →
   *deterministic floor*). For accounts the floor is **not** a heuristic parse —
   it's "prefill nothing extra, use the gate's `subtypeHint`, and let the Q&A
   ask." So even fully offline with no key, a gate hit still produces a good
   prefill (subtype from the noun) and drops into the Q&A for the name.
2. Run the first available engine with the **account contract** → get
   `{ name, subtype }` (already token-support-guarded).
3. Compute `openingBalance = parseOpeningBalance(text)` — **deterministic, from
   the raw utterance**, never the model.
4. Assemble a prefilled `AccountDraft { name, subtype?, openingBalance }`,
   **filling deterministic defaults for anything the extraction/guard didn't
   produce** (decision: a partial utterance goes straight to an editable
   confirm card, it does NOT drop into a Q&A):
   - `name` missing/hallucinated → default from the gate's noun/subtype:
     `cash→"Wallet"`, `bank→"Savings"` (or "Bank account"), `credit_card→
     "Credit card"`, `loan→"Loan"`, `investment→"Investment"`, else "Account".
   - `subtype` missing → the gate's `subtypeHint` (may stay `unknown`/unset — it
     is optional).
   - `openingBalance` = `parseOpeningBalance(text)` (deterministic).
5. **Every gate hit lands on the confirm card** (never a question) — prefilled
   with the above and **fully editable**: the card exposes an editable **name**
   field, **subtype** chips (`ACCOUNT_SUBTYPE_CHOICES`), and an editable
   **balance**, so a defaulted "Wallet" or a wrong subtype is a one-tap fix
   before Create.
6. Confirm card → `createAccount` (currency stamped from settings). **No silent
   creation, ever.**

This reuses `ACCOUNT_SUBTYPE_CHOICES` + the confirm/`createAccount` hand-off;
the new surface is the gate + contract + a "build a confirm-ready `AccountDraft`
from a prefilled draft" seam in `accountAssistant.ts`, plus making the account
confirm card's fields editable (name/subtype/balance). The `/account` Q&A stays
as-is for the explicit command and is the offline path's fallback for the name.

### 5.5 Metrics

Extend the existing parse metric (metrics-gated builds only) to record account
creations with the engine that served the extraction (`openai`/`anthropic`/
`on_device`/`floor`) and outcome (`confirm`/`clarify_missing`/`created`/
`discarded`) — same shape as the expense metric, so the debug screen shows which
engine handled it. No PII (guardrail #5): engine + outcome + coarse buckets only.

## 6. End-to-end examples

| Utterance | gate | engine extract | balance (det.) | enters flow at | result |
|---|---|---|---|---|---|
| "add a DBS savings account with 500" | hit, hint=bank | name=DBS Savings, bank | 50000 | confirm | card: DBS Savings · bank · $500 (editable) |
| "make a wallet" | hit, hint=cash | name="" → default "Wallet" | 0 | confirm | card: **Wallet** · cash · $0 — editable name |
| "open Amex card" | hit, hint=credit_card | name=Amex, credit_card | 0 | confirm | card: Amex · credit card · $0 (editable) |
| "add 500 to savings" | **miss** (amount+prep) | — | — | — | falls to expense ladder |
| "paid mum 50" | **miss** (no noun) | — | — | — | falls to expense ladder |

## 7. Guardrails & constraints

- **Model never decides intent** (deterministic gate) and **never touches
  numbers** (`parseOpeningBalance`). (Probe §3.)
- **Confirm before write** — the only path to `createAccount` is the confirm
  card.
- **Untrusted model output** (CLAUDE.md #6) — token-support guard + zod
  re-validation on the extracted draft.
- **No new persisted PII / no new network endpoints** (CLAUDE.md #3, #5) —
  BYOK calls go direct to the user's own provider, same as the expense path.
- **Framework-free brain** — the gate, contract normalize, and flow seam stay
  in `src/domain/*` so the plain-Node BDD suite covers them; only the engine
  wiring lives in `src/features/ai` / the screen.

## 8. Acceptance criteria (testable)

Pure-Node BDD (`tests/`):
1. `detectAccountIntent` — a **collision test set** passes: the 5 positive
   probe utterances hit with the right `subtypeHint`; `"add 500 to savings"`,
   `"move 200 into wallet"`, `"paid mum 50"`, `"lunch 18"`, `"how much did I
   spend"` all **miss**.
2. Token-support guard + default: given a model output `name="DBS Savings"` for
   source `"add account"`, the guard discards it and the assembled draft's
   `name` is the deterministic default ("Account"), never the hallucinated value.
3. Number authority: `openingBalance` always equals `parseOpeningBalance(text)`
   regardless of any number the model returned.
4. Confirm-ready assembly: every gate hit produces a complete `AccountDraft`
   (name defaulted if needed, subtype from hint, deterministic balance) → the
   confirm card, never a question. Defaults: `"make a wallet"→name "Wallet"`,
   subtype cash.
5. No engine available (offline, no key, FM incapable) → gate hit still yields a
   subtype-defaulted confirm card, never an error.
6. Confirm-card edits: name/subtype/balance are editable and the edited values
   are what `createAccount` persists.

Manual on-device (metrics build): each of FM / BYOK-OpenAI / BYOK-Anthropic
serves a one-shot creation end-to-end; the confirm card shows correct
(editable) fields; the debug metric shows the expected engine.

## 9. Files

New: `src/domain/accountIntent.ts`, `src/domain/accountParsePrompt.ts`,
`src/domain/accountParseSchema.ts`, tests under `tests/`.
Changed: `src/features/ai/engines/{openai,anthropic}.ts` +
`engines/shared.ts` (contract param), `src/features/ai/deviceParse.ts`
(second FM contract), `src/domain/accountAssistant.ts` (prefill-entry seam),
`app/(tabs)/index.tsx` (`runParse` gate + assembly), metrics.

## 10. Eval (deferred — do after on-device validation)

Once the gate rules settle, add an **account** dataset + scoring axis to the
harness on `claude/parse-eval` (name/subtype/balance + intent-discrimination
cases), reusing the exact machinery that grades expenses across FM/OpenAI/
Anthropic. This gives the same cross-engine regression gate for accounts.
Stubbed here on purpose; not a v1 blocker.

## 11. Open questions / risks

1. **Gate precision** is the whole ballgame — `"add 500 to savings"` (noun +
   amount + prep) is the trap; the amount/preposition exclusion in §5.1 must be
   validated against a broad collision set before trusting it.
2. **Contract parameterization ergonomics** — confirm the `fetch*Raw` signature
   change stays clean and doesn't disturb the expense path's eval numbers
   (re-run `npm run eval` + `eval:cloud`/`eval:openai` after).
3. **FM second `@Generable`/schema on-device** — verified in the probe at the
   Swift level; confirm the RN `@react-native-ai/apple` `generateObject` path
   accepts the account zod schema on a device build.
4. **Value vs surface** — accounts are low-frequency; this adds a second
   contract + drift guards. Accepted deliberately for a single consistent
   "chat brain" across engines (Ask-Xavier direction), not because cloud users
   would otherwise be blocked (the Q&A already covers them).

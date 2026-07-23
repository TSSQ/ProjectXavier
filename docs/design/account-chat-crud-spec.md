# Spec: chat account UPDATE + DELETE (option C + B primitives) — Phase 2

**Branch:** `claude/phase2-byok` · **Status:** design + probe · **Author:** Xavier session, 2026-07-23
**Builds on:** `account-chat-creation-spec.md` (the create feature — gate, ParseContract, confirm card).

## 1. Objective

Extend chat account CRUD from create to **update** and **delete**, chosen as
**Option C (chat edits; screen deletes)**:
- **Update via chat** — rename / re-type / re-balance an existing account
  ("rename my DBS account to Rainy Day", "change my wallet to a credit card",
  "set OCBC balance to 5000") → editable confirm card → `updateAccount`.
- **Delete via chat = RECOGNIZE + HANDOFF, never execute.** "delete my DBS
  account" is recognized, but chat responds with the impact ("that permanently
  deletes 47 transactions, incl. 3 transfers with OCBC — OCBC's balance will
  change") and **deep-links to manage-accounts** with the account pre-selected.
  No hard delete is ever triggered from natural language.
- **Hard-delete cascade PRIMITIVE (B)** — built properly (`deleteAccountCascade`),
  but reachable ONLY from the manage-accounts screen behind a typed-name confirm
  + a forced pre-delete backup.

**Why C, not full-chat-delete:** the create gate needed TWO adversarial rounds
to kill false-positive classes that merely *offered a card*; the identical miss
on delete is irreversible data loss, and NL is our highest-misfire input. Delete
is a ~once-a-year action — near-zero value saying it in chat, maximum cost if
misfired. Updates are frequent and low-stakes — that's where chat CRUD earns its
keep.

## 2. What exists / what's new

- `updateAccount(account)` already exists (`src/features/accounts/repository.ts`)
  — full-row update. Archive is `updateAccount({...acc, archived:true})`.
- **Archive already excludes from net worth + dashboard + widget**
  (`src/domain/balances.ts:56-114` filter `!archived`; dashboard + widget too).
  So archive is a genuine "remove from view + net worth", transactions kept,
  restorable. Chat should keep offering archive for "get rid of it".
- **No hard delete exists anywhere** — `deleteAccountCascade` is NEW.
- **No account fuzzy-matcher exists** (`findAccountMatch` absent) — NEW, mirrors
  `findPayeeMatch`/`findCategoryMatch` (`src/domain/payees.ts`/`categories.ts`).
  This is the new hard capability update/delete need (matching the user's spoken
  account to a real row) — the probe (§6) stresses exactly this.
- **Transfers are a SINGLE row** (`transferAccountId`, `src/db/schema.ts:47`);
  `balances.ts:24-27` credits the destination off that same row. There is NO
  contra row. Deleting the row IS "delete both sides" — but note the blast
  radius: a transfer where B sent A money lives on B, so cascade-deleting A's
  transfers rewrites B's history + balance. This cross-account effect is a
  first-class spec requirement, not a detail (§5.4).

## 3. Scope

**In:** chat update (rename/retype/rebalance) across FM + BYOK; chat delete
recognition + manage-accounts deep-link handoff; `deleteAccountCascade` primitive
+ its screen-only typed-confirm UI + pre-delete backup + counterparty warning; a
deterministic `findAccountMatch`.

**Out:** chat-triggered hard delete; bulk operations; merging accounts;
un-delete/trash (iCloud backup is the undo story — CLAUDE.md #1).

## 4. Intent taxonomy (gate extension, `src/domain/accountIntent.ts`)

Today the gate returns account-CREATE or null. Extend to a discriminated result:
`{ op: 'create' | 'update' | 'delete', subtypeHint?, ... }`.
- **create** — existing rules (create/add/open/make/new/set up/start + account noun).
- **update** — an EDIT verb (`rename | change | update | edit | set | rebalance |
  make ... a` when targeting an existing account) + a reference to an existing
  account. Same government + attributive guards apply.
- **delete** — a DELETE verb (`delete | remove | close | get rid of`) + account
  reference. Note collisions the create-gate already taught us: "remove 50 from
  savings" (government rule → MISS as account-op, it's an expense); "close the
  app" (no account noun → MISS).
The model NEVER decides op — deterministic as before. The op determines which
downstream flow runs.

## 5. Design

### 5.1 Target-account matching — `findAccountMatch(text, accounts)` (NEW, deterministic)
Mirror `findPayeeMatch`: exact → case-insensitive → token/substring → fuzzy, with
a confidence + a `suggestion` for near-misses. Update/delete MUST resolve the
spoken target to a real account row; the MODEL may propose a target *string*, but
the deterministic matcher resolves it (never trust a model-invented account id).
Ambiguous (2+ plausible) or no match → the confirm/handoff asks "which account?"
rather than guessing. **This is the capability the probe validates before we
commit to model-assisted matching vs pure-deterministic.**

### 5.2 Update contract (extends the account ParseContract)
Model extracts STRINGS ONLY: `targetName` (the account the user referred to),
`operation: 'rename' | 'retype' | 'rebalance'`, `newName?`, `newSubtype?`. The new
balance is DETERMINISTIC (`parseOpeningBalance` on raw text) — never the model's
number (same principle as create). Token-support guard + zod re-validation.
Flow: gate=update → extract → `findAccountMatch(targetName)` → build an editable
confirm card pre-filled with the change ("Rename DBS Savings → Rainy Day?" /
"OCBC opening balance → $5,000?") → `updateAccount`. Confirm-before-write.

### 5.3 Delete handoff (chat)
gate=delete → `findAccountMatch` → compute impact counts (see 5.4) → chat reply:
"Deleting **DBS Savings** permanently removes 47 transactions (incl. 3 transfers
with OCBC, which changes OCBC's balance). Archive instead keeps them. [Delete in
Accounts] [Archive]" → deep-link to manage-accounts with the account pre-selected
(or one-tap archive inline). NL never executes the cascade.

### 5.4 `deleteAccountCascade(id)` primitive (NEW, screen-only)
One Drizzle transaction (guardrail #4 parameterised): (a) snapshot impact —
count/collect tx where `accountId=id` OR `transferAccountId=id`, and recurring
rules referencing `id`; (b) **forced pre-delete backup** using the F3
`data_revision` machinery so guardrail #1's round-trip can restore the pre-delete
world; (c) delete those transactions, (d) delete/disable recurring rules
referencing the account (else they post into a void — `src/features/recurring/`),
(e) delete the account row; commit. **Cross-account balance effect** is surfaced,
not hidden: the counterparty warning lists every other account whose balance
changes. Wrap so a failure rolls back the whole cascade.

### 5.5 Screen delete UI (manage-accounts.tsx)
A destructive "Delete permanently" path distinct from Archive: opens a sheet with
the impact counts + a **typed-name confirmation** (type the account name to
enable Delete — a tap is not enough for irreversible cascade) → `deleteAccountCascade`.

## 6. Probe plan — "see the model's capabilities" (DO THIS FIRST)

Before building, a Mac-side FM probe (mirror `scratchpad/acct-probe`) tests the
NEW hard parts of update extraction, given a fixed known-accounts list
(e.g. ["DBS Savings", "OCBC Current", "Cash Wallet", "Amex"]):
1. **Target matching** — does the model pick the right known account from a loose
   reference? "rename my savings to X" → DBS Savings; "change ocbc balance" →
   OCBC Current; "my amex" → Amex. Does it hallucinate a target not in the list?
2. **Operation classification** — rename vs retype vs rebalance from phrasing.
3. **Value extraction** — new name / new subtype (strings). (Numbers stay
   deterministic — probe just checks it doesn't mangle the rest.)
4. **Op discrimination** — update vs create vs delete vs expense on one line
   ("rename my wallet" ≠ "add a wallet" ≠ "delete my wallet" ≠ "wallet 50").
5. **Delete-target ID** — "delete my DBS account" → target DBS Savings.

Decision the probe drives: if target-matching is weak, do it PURELY
deterministically (`findAccountMatch` on the raw text, model only classifies
op/extracts strings); if strong, let the model propose the target string and
deterministically verify. Either way the model never gets an account id.

### 6.1 Probe RESULTS (FM, 2026-07-23 — `scratchpad/acct-update-probe`)
Known accounts: DBS Savings, OCBC Current, Cash Wallet, Amex.
- **Target matching: EXCELLENT (10/10 where a match was expected)** — incl. the
  hard semantic ones a string-matcher can't do: "my current account"→OCBC
  Current, "the card"→Amex (via card=credit), "my savings"→DBS Savings,
  "my amex"→Amex. This is the capability we most doubted; the model has it.
- **Operation classification: mostly right, not bulletproof** — rename/retype
  solid; rebalance inconsistent ("update ocbc opening balance"→rebalance ✓, but
  "set OCBC balance to 5000"→unknown/conf 0.00 ✗). Verb-pattern phrasing is
  exactly what deterministic code does more reliably.
- **No true hallucination of a target** — "add a new wallet" (a CREATE) forced a
  match to Cash Wallet, but that's MOOT: the deterministic gate decides
  create-vs-update BEFORE the update extractor runs, so a create never reaches it.
- **⚠️ FM guardrail false-positives: 2/14 (~14%)** — "make my cash wallet a bank
  account" and "rename my brokerage to Growth" both threw
  `guardrailViolation("unsafe content")` on innocuous financial text. Apple-side
  over-triggering we can't fix; BYOK cloud engines won't share it.
- **Confidence useless** (0.00 on a correct target), as in the create probe.

### 6.2 Probe RESULTS (BYOK cloud, 2026-07-23 — `scratchpad/acct-update-probe/byok.mjs`, gpt-4o-mini + claude-haiku-4-5)
Same 14 cases. **Both cloud engines beat FM — and specifically on the cases FM
fumbled:**
- **Target matching: 12/12 on both** (every case that should match, matched),
  INCLUDING the two FM missed: "add a new wallet" (a CREATE) → target `""` on
  both (FM force-matched Cash Wallet); "rename my brokerage" (not in list) →
  target `""` on both (FM threw a guardrail error). **No hallucinated targets.**
- **No guardrail false-refusals** — the two innocuous lines FM refused
  ("make my cash wallet a bank account", "rename my brokerage") both extracted
  cleanly on cloud.
- **Operation classification:** Anthropic 100% (incl. both rebalance phrasings and
  "change the card to Amex Platinum"→rename); OpenAI one quibble ("change the
  card…"→retype instead of rename — read "card" as a subtype cue).
- **Confidence is actually a weak-but-real signal on cloud** (unlike FM's noise):
  low (0–0.3) exactly on the genuinely-ambiguous/no-target cases
  ("delete…"→0.3, "brokerage"→0/0.3), 0.8–1.0 on the clean ones. Still not gated
  on, but the earlier "useless" call was FM-specific.

Ranking for update: **Anthropic ≳ OpenAI > FM**. FM's guardrail over-refusals
(~14%) are its real liability here; cloud has none.

**Verdict → design refinement (resolves §9 open Q):** DETERMINISTIC-FIRST,
model-assisted — unchanged by the cloud result, and here's why even though cloud
is near-perfect: (a) FM (the default, no-key tier) still needs the deterministic
floor for its guardrail refusals; (b) `findAccountMatch` re-resolution is cheap
insurance against a hallucinated target on some phrasing we didn't probe; (c)
numbers stay deterministic regardless. `findAccountMatch` (deterministic) is the
primary resolver + verifier; op is classified by deterministic verb-patterns
first. The model's output (target string, op, new name) is an ENHANCEMENT —
adding semantic matching the string-matcher can't ("the card"→Amex, proven on
all 3 engines) — ALWAYS re-resolved through `findAccountMatch`; a model
refusal/failure falls back to the deterministic path. The model is never
load-bearing, but on BYOK it's excellent, so the confirm card will pre-fill the
right account + operation confidently for cloud users.

## 7. Guardrails
- Model never decides op, never touches numbers, never gets/returns account ids.
- Every destructive path (cascade) forces a pre-delete backup (CLAUDE.md #1) and
  a typed-name confirm; NL never triggers it.
- Cross-account balance change is disclosed, never silent.
- Parameterised SQL only (Drizzle) (#4); zod on the model output (#6).

## 8. Acceptance criteria (testable, pure-Node where possible)
1. `findAccountMatch` resolves exact/case/fuzzy, flags ambiguous, returns null on
   no match — BDD.
2. Gate op-discrimination: update/create/delete/expense collision set (incl.
   "remove 50 from savings" → NOT a delete-op).
3. Update contract: operation classified, target string extracted, new balance ==
   `parseOpeningBalance(text)` regardless of model number; zod-guarded.
4. `deleteAccountCascade`: deletes accountId OR transferAccountId rows + the
   account in one tx; recurring rules handled; net worth + a counterparty's
   balance recomputed correctly after; a forced backup exists before the delete;
   rollback on failure — BDD against an in-memory DB.
5. Chat delete NEVER calls `deleteAccountCascade` (only the screen does).

## 9. Open questions
- Model-assisted vs pure-deterministic target matching — **the probe (§6) decides**.
- Recurring rules on a deleted account: delete them, or block the delete until the
  user reassigns? (lean: delete + name them in the warning.)
- Widget/summary tolerating an account vanishing between renders (verify).

# ADR 0004 — Avatar evolution mechanic: the buildable slice

- **Status:** Superseded by [ADR 0005](0005-remove-gamification.md)
- **Date:** 2026-06-27
- **Deciders:** ProjectXavier team
- **Related:** `src/domain/avatar.ts`, `src/components/avatars/registry.tsx`,
  `src/components/AssistantAvatar.tsx`, `src/domain/balances.ts`
  (`netWorthAsOf`), `src/features/settings/repository.ts`
  (`getSetting`/`setSetting`).

## Context

ADR 0003 set the gamification direction. Of its three threads, two are **not
code right now**: creature-art *production* is a creative/manual workflow, and
the *store* (IAP / entitlements / purchase-gating) is a large separate effort
needing StoreKit + receipt verification. The **evolution progression mechanic**
is the part that is fully buildable, testable, and valuable today. This ADR
records the concrete decisions for that build so it can proceed without
re-litigating ADR 0003.

## Decision

### 1. Signal = net-worth *growth over a stored baseline* (not absolute)
A **baseline** net worth is captured the first time net worth is computed with
at least one account present. Progression is driven by **growth = current net
worth − baseline**, in the single app-currency minor units. This is fair across
income levels (a wealthy user starts at their own baseline and must still grow;
a low-income saver can fully progress), avoiding the "rich user starts maxed /
saver never levels" failure of absolute net worth.

### 2. No devolve — high-water mark
Persist the **maximum growth ever observed** (`progression_highwater`). The
stage derives from the high-water value and **never decreases**; a net-worth dip
is never punished by regressing the avatar. (Short-term dips are expressed via
the existing transient `AvatarState`, per ADR 0003 — not in this build.)

### 3. Stage ladder (data, tunable)
A pure ladder of ~5 stages, each with a growth threshold in minor units, e.g.
0 / +500 / +2,000 / +10,000 / +50,000 (app currency). `stageForGrowth(growth)`
returns the highest stage whose threshold ≤ growth. Thresholds live as data so
they are easy to tune and test.

### 4. Persistence
Two keys in the existing key/value settings store
(`getSetting`/`setSetting`): `progression_baseline` and
`progression_highwater`. They ride along in encrypted backups like other
settings (no special handling). No new table.

### 5. Visual treatment (no new art)
`stage` is threaded through the avatar render props
(`registry.tsx` → renderer) and drives a **simple treatment on the existing
blob** — e.g. subtle scale + a glow/aura and a "Lv N" badge that grow with
stage. **No new creature art, no new `kind`.** This makes the mechanic visible
without blocking on the art pipeline.

### 6. UI surface
A small level badge + progress-to-next-stage indicator on the assistant screen
(`app/(tabs)/index.tsx`), fed by a pure `progressToNext(growth)` helper.

## Scope

**In:** pure `src/domain/evolution.ts` (`EVOLUTION_STAGES`, `stageForGrowth`,
`progressToNext`) + BDD tests; baseline/high-water persistence; a
`refreshProgression(netWorthMinor)` that captures baseline, advances high-water,
returns `{ stage, growth, fraction, … }`; `stage` threaded through render props
with a simple visual treatment; the level/progress UI on the assistant screen.

**Out of scope (do not build here):** creature-art production, new avatar
`kind`s, Rive/Lottie, IAP / entitlements / ownership / purchase-gating of looks
or kinds, devolve/decay, and any net-worth *punishment* mechanic.

## Consequences / tradeoffs

**Positive**
- Ships the visible gamification loop with pure, testable domain logic that
  mirrors the existing `avatarStateFor` pattern; no new dependency, no new table.
- Fair, inclusive progression; no shame mechanic.
- Clean seam for ADR 0003's later work: art lands as new `kind` renderers; the
  store lands as an entitlement layer — neither requires reworking this mechanic.

**Negative / accepted**
- The visual reward is a simple treatment on the blob until real per-stage art
  exists, so the "wow" of evolution is muted at first.
- Baseline is captured once and stored locally; resetting it (e.g. a deliberate
  "restart my journey") is not in this build.

## Open questions (deferred, not blocking)

- Final stage count + threshold values (start with the ladder above; tune from
  real usage).
- Whether late stages should also consider time/streak signals (ADR 0003's
  growth-streak idea) — deferred; this build is net-worth-growth only.

## Implementation impact

New `src/domain/evolution.ts` + tests; new settings keys + a small
`refreshProgression`; `AvatarRenderProps`/renderer gains an optional `stage`;
`app/(tabs)/index.tsx` shows the level/progress UI. No schema change, no new
dependency.

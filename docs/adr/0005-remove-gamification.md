# ADR 0005 — Remove avatar evolution/leveling gamification; retain avatar moods

- **Status:** Accepted
- **Date:** 2026-06-27
- **Deciders:** ProjectXavier team
- **Related:** [ADR 0003](0003-avatar-evolution-gamification.md) (superseded),
  [ADR 0004](0004-avatar-evolution-mechanic-build.md) (superseded),
  `src/domain/avatar.ts`, `src/components/avatars/registry.tsx`,
  `src/components/AssistantAvatar.tsx`

## Context

ADR 0004 shipped an avatar evolution system driven by net-worth growth: a
`stage` axis threaded through the render props, a `LevelBadge` on the assistant
screen, a `StageWrap` aura treatment, and a `progression` feature
(`src/domain/evolution.ts`, `src/features/progression/`) that persisted
`progression_baseline` and `progression_highwater` settings keys.

The gamification loop has been re-evaluated and the decision is to remove it.
The avatar's expressive mood system (idle / listening / thinking / happy /
confused / angry, including the angry-on-expense reaction) is a separate concern
and is retained as-is.

## Decision

Remove all evolution/leveling/progression code:

- Delete `src/domain/evolution.ts` and `src/features/progression/repository.ts`.
- Remove the `stage` prop from `AvatarRenderProps` and `AssistantAvatar`; delete
  `StageWrap` and `EVOLUTION_VISUAL_CAP` from the avatar registry.
- Remove the `LevelBadge` component and the `progression` state from the
  assistant screen (`app/(tabs)/index.tsx`); `loadContext` no longer calls
  `listTransactions` or `refreshProgression`.
- Remove `PROGRESSION_BASELINE_KEY`, `PROGRESSION_HIGHWATER_KEY`, and the four
  accessor functions from `src/features/settings/repository.ts`.
- Strip `app/debug-avatar.tsx` to a state-only preview (no stage controls, no
  consistency strip).
- Remove the BDD evolution tests
  (`tests/__features__/evolution.feature`, `tests/__steps__/evolution.steps.ts`).

**Existing `progression_baseline` / `progression_highwater` rows in the settings
table on user devices are left in place** — nothing reads them and they ride
inertly in encrypted backups. No migration is needed.

**Avatar moods are fully retained.** `AvatarState`, `avatarStateFor`, and the
angry-on-expense reaction in `onConfirm` are unchanged.

## Consequences

**Positive**
- Removes a speculative feature that added complexity without a validated
  user-value story.
- Simplifies the assistant screen: no DB query for transactions on focus, no
  progression state, no level badge UI.
- `AvatarRenderProps` and `AssistantAvatar` are simpler (no `stage`); the avatar
  render path is back to a single swap point with no conditional treatment.
- Test suite shrinks by the evolution scenarios; the avatar-mood tests remain.

**Negative / accepted**
- Users who had progressed to a higher stage will no longer see it; the feature
  was live only briefly and the stage was visual-only (no entitlements or rewards
  attached).
- The orphaned settings rows are harmless but permanently inert unless a future
  migration cleans them.

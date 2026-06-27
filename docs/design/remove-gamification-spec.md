# Build spec: remove gamification (evolution/leveling); keep the avatar

## Objective
Remove the net-worth-driven avatar evolution/leveling system and all its UI,
while leaving the avatar — its looks, kinds, and moods (idle/listening/thinking/
happy/confused/angry, including the angry-on-spend reaction) — fully intact.

## Scope (in)
- **Delete** the progression domain + feature + tests.
- **Unwire** the `stage` axis from the avatar render path and the assistant
  screen (remove the level badge + stage visual treatment).
- **Strip** the dev avatar screen down to a state-only preview.
- **Remove** the progression settings keys/accessors.
- **Update ADRs** to mark the feature reverted.

## Scope (out — do NOT touch)
- `src/components/ui/XavierPet.tsx` (the avatar drawing/animation) — unchanged.
- `src/domain/avatar.ts` — `AvatarState` (all six states), `avatarStateFor`,
  `AvatarKind`, `AvatarLook`, looks/kinds — unchanged.
- Avatar **moods**, including the **angry-on-expense** reaction in
  `app/(tabs)/index.tsx` `onConfirm` — **kept** (see Risks).
- Settings avatar look/kind pickers, currency, icon sets — unchanged.
- The on-device DB schema — **no migration** (progression lived in the `settings`
  key/value table, not a column).
- Design mocks/specs under `docs/design/` — historical, leave as-is.

## Approach

**Delete files**
- `src/domain/evolution.ts`
- `src/features/progression/repository.ts` (and the now-empty
  `src/features/progression/` dir)
- `tests/__features__/evolution.feature`
- `tests/__steps__/evolution.steps.ts`

**`src/components/avatars/registry.tsx`**
- Remove `stage` from `AvatarRenderProps`; delete `StageWrap` and
  `EVOLUTION_VISUAL_CAP`; revert the `blob` renderer to
  `({ size, state, variantId }) => <XavierPet size={size} state={state} look={lookById(variantId)} />`.
- Drop now-unused imports: `View` (react-native) and `colors`.

**`src/components/AssistantAvatar.tsx`**
- Remove the `stage` prop (param, type, and from the `renderAvatar` call) → back
  to `{ size, state }`.

**`app/(tabs)/index.tsx`**
- Remove imports `refreshProgression`, `ProgressionSnapshot` (from
  `features/progression/repository`) and `listTransactions` (only used for
  progression now).
- Remove the `progression` state.
- `loadContext`: load accounts only — `const accts = await listAccounts();
  setAccounts(accts);` (drop the `listTransactions` call and `refreshProgression`).
- Avatar render: remove `stage={…}` and the `{progression ? <LevelBadge … /> :
  null}` line.
- Delete the `LevelBadge` component (~lines 357–376).

**`src/features/settings/repository.ts`**
- Remove `PROGRESSION_BASELINE_KEY`, `PROGRESSION_HIGHWATER_KEY`, and the four
  accessors (`get/setProgressionBaseline`, `get/setProgressionHighWater`) and
  their doc block. Leave `getSetting`/`setSetting`/`getAllSettings` untouched.

**`app/debug-avatar.tsx`** (strip to state-only preview)
- Remove the `EVOLUTION_STAGES` import, `stage` state, `maxStage`,
  `onEvolve`/`onReset`, the **Stage controls** block, the **All stages
  (consistency strip)** block, the `stage` prop on `AssistantAvatar`, and the
  "Stage N · label" text.
- Keep the large `AssistantAvatar size={172} state={state}` + the **State**
  selector. Drop the now-unused `renderAvatar` import. Update the header copy to
  drop "progression/stage" language (e.g. "Avatar state preview").
- Settings → Developer "Avatar preview" row stays (still routes here).

**ADRs**
- Add `docs/adr/0005-remove-gamification.md` (Status: Accepted) recording this
  decision and that the avatar is retained; it supersedes 0003 & 0004.
- Change the **Status** line of `docs/adr/0003-…md` and `docs/adr/0004-…md` to
  "Superseded by [ADR 0005]".

## Requirements / acceptance criteria
- [ ] `src/domain/evolution.ts` and `src/features/progression/` no longer exist.
- [ ] `grep -rn "evolution\|progression\|Progression\|LevelBadge\|StageWrap\|EVOLUTION_STAGES\|refreshProgression" src app tests`
  returns **no code references** (ADR prose aside).
- [ ] `AvatarRenderProps` has no `stage`; `AssistantAvatar` accepts only
  `size`/`state`; no `StageWrap` / aura / micro-scale anywhere.
- [ ] Assistant screen renders the avatar with **no level badge / progress
  pill**; no `progression` state; `loadContext` no longer calls
  `listTransactions` or `refreshProgression`.
- [ ] `settings/repository.ts` exports no `*Progression*` functions and defines
  no `progression_*` keys.
- [ ] `app/debug-avatar.tsx` shows avatar + state selector only (no Evolve/Reset,
  no stage label, no consistency strip).
- [ ] **Avatar moods intact:** `AvatarState` still has all six states;
  `avatarStateFor` unchanged; saving an **expense** still triggers the angry
  reaction (`onConfirm` sets `lastOutcome='spent'`);
  `tests/__features__/avatar-mood.feature` still passes.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green; no unused imports
  (notably `View`/`colors` in registry, `listTransactions` in index); no
  jest-cucumber "no matching step" errors from leftover feature files.
- [ ] ADR 0005 added; 0003 & 0004 marked Superseded.

## Constraints & conventions
- Remove cleanly — no commented-out code or dead exports.
- No DB migration; do not delete existing `progression_*` rows (leave inert).
- Keep the avatar render path the single swap point (registry) exactly as before
  the stage axis was added.

## Edge cases & risks
- **Resolved assumption (flag for the user):** "gamification" = the
  evolution/level/progression loop. The avatar's **moods, including
  angry-on-spend, are kept** as avatar expressiveness. If the intent was also to
  remove the angry-on-spend reaction, that's a separate ~10-line follow-up
  (revert `onConfirm` to always `'saved'` and drop the `'angry'`/`'spent'`
  mapping) — not done here.
- **Orphaned settings rows:** existing devices may hold
  `progression_baseline`/`progression_highwater` in the `settings` table. Nothing
  reads them; they're harmless and ride inertly in backups. No cleanup needed.
- **Straggler imports:** confirm nothing outside index/debug-avatar imported
  `evolution`/`progression` (the grep criterion covers this).
- Test count drops by the evolution scenarios — ensure the removed `.feature`
  doesn't leave a dangling `loadFeature` reference.

## Suggested handoff
> Use the implementer agent to build the spec above. Then run qa-tester on the
> diff (focus: no progression/stage references remain, avatar moods incl.
> angry-on-spend still work, suite green with evolution tests removed). Then
> reviewer.

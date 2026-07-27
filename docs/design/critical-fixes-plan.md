# Plan: incorporating the critical review fixes into `main`

Briefing for any session picking up this work. Written 2026-07-19 after the
2026-07-18 external repo review was fully verified against `main` (all 16
findings confirmed; verification record in the session memory
`main-live-line-branch-stale`). Read this file, the three specs it references,
and `CLAUDE.md` before touching code.

## Why this exists

`main` is the live line: **build 42, the App Store submission candidate**
(commit `063563e`). The review confirmed three critical defects that should be
fixed before submission — each has a build spec in this directory:

| Fix | Spec | Size | Blocked on |
|---|---|---|---|
| F2 — copied incoming transfer becomes a self-transfer and debits the account | `self-transfer-guard-spec.md` | Small | nothing |
| F3 — edits to existing data never trigger auto-backup (store doc's M4) | `backup-data-revision-spec.md` | Small–Medium | nothing |
| F1 — currency switch silently relabels/mixes historical amounts (M7 unenforced) | `currency-freeze-integrity-spec.md` | Medium | two user forks, below |

Target outcome: both ships merged to `main` → **build 43** → device-confirm
checklists from the specs → updated submission answer sheet → store submission.

## Git state (as of 2026-07-19)

- **Work branch: `claude/critical-fixes-f1-f3`**, cut from `origin/main`
  `063563e`. All fix work happens here. Specs + this plan are committed on it.
- **`main` is protected by convention** — never commit or push to it directly
  (CLAUDE.md). PR from the fix branch into `main`.
- **Old branch `claude/expense-tracker-app-y7rgas` is stale** — it diverged
  ~25 commits behind main and its one unique commit (`c353b73`) is superseded:
  main re-implemented the Face ID toggle better (opt-in, auth-gated,
  device-local). The only piece worth salvaging is its avatar cleanup (drop
  the "Soon" avatar kinds — main still ships them, `settings.tsx:272`), which
  must be **re-implemented** against main's rewritten settings screen, not
  cherry-picked (all three shared files conflict). CLAUDE.md still names the
  old branch as "the feature branch" — that line is stale; update it to the
  current fix branch in the first PR (flag the CLAUDE.md edit in the PR
  description so it's visible).
- **Always `git fetch origin` before reasoning about `main`** — stale local
  refs already misled one verification pass in this project.

## Phase plan

### Phase 1 — Ship "critical fixes A" (no user input needed)
On `claude/critical-fixes-f1-f3`, in order, one commit per item:
1. **F2** per `self-transfer-guard-spec.md` (copy fix, zod refines, picker
   guard, neutral `signedDelta`, one-time scan).
2. **F3** per `backup-data-revision-spec.md` (`bumpDataRevision()` at every
   repository chokepoint, v2 signature, device-local key).
3. *Rider (small):* avatar cleanup re-applied against main (F16 sliver — drop
   `character`/`animated` kinds from `src/domain/avatar.ts` and the Settings
   rows; port the branch's BDD scenario updates).
4. *Rider (small):* F11 CI trust — point the e2e job at the `simulator` EAS
   profile (the `preview` profile is a device build yet CI `simctl install`s
   it). **Caveat:** the review also wants a missing `EXPO_TOKEN` to fail
   rather than pass; this project sometimes runs with GitHub Actions budget
   exhausted (see memory: push-but-no-PR mode), so hard-failing may block
   merges — implement the profile fix unconditionally, ask the user before
   making the job required.

Gate for every commit: `npm run typecheck && npm run lint && npm test` green
(BDD suite is plain Node; domain logic stays framework-free). Spec acceptance
criteria are the definition of done; device-confirm items carry to Phase 3.

### Phase 2 — Ship "currency freeze" (needs the two forks answered)
Implement `currency-freeze-integrity-spec.md` once the user confirms:
1. **Freeze point** — proposed: freeze on first *transaction*; accounts-only
   still switchable via explicit relabel confirm.
2. **Mixed ledger handling** — proposed: warn + guided relabel, not the
   review's block-all-reporting.
If the user approves the proposed defaults, no other product input is needed.

### Phase 3 — Release
1. PR(s) from `claude/critical-fixes-f1-f3` into `main`; merge per CLAUDE.md
   (watch CI, merge on the user's behalf). **Tooling note:** `gh` is
   unauthenticated and GitHub MCP is unavailable in this environment (memory:
   git-push-over-ssh) — push always works over SSH; if no authenticated PR
   path exists in-session, ask the user to click "open PR" on the pushed
   branch rather than silently skipping it.
2. Build 43 via the **release-manager agent** (`/build`): bump
   `ios.buildNumber` to 43 in `app.config.ts`, two-target manual signing per
   the proven recipe (memory: widget-build24-signing — June-27 cert, not
   June 28), verify `gitCommitHash` matches the intended tree (memory:
   eas-build-verify-commit).
3. Run the **device-confirm checklists** from all three specs on the build.
4. Update `docs/design/app-store-submission.md`: build number (still says 36),
   plus a line that M4 and the M7 enforcement are now fixed (M5 remains open).
5. TestFlight soak, then submission (user clicks in ASC).

### Later backlog (explicitly out of these ships)
In rough priority order after the criticals: F5 recurring atomicity (unique
occurrence index + `db.transaction`), F6 restore pre-snapshot + retention
identity, F9 versioned migrations (unblocks the F2 CHECK constraint and F1
exponent-native storage), F4 civil dates, F7 FKs/archive-not-delete, F13
refund semantics + FM timeout + amount bounds (M5), F14 test layers, F15
a11y/locale, F16 doc rewrite (`SECURITY.md` self-contradicts, `RUNNING.md`
predates on-device AI).

## Decisions pending (owner: user)
1. F1 fork — freeze point (proposed: first transaction).
2. F1 fork — mixed ledger warn-vs-block (proposed: warn + relabel).
3. Old branch disposal — delete `claude/expense-tracker-app-y7rgas` after the
   avatar rider lands, and update CLAUDE.md's branch reference.
4. F11 strictness — make e2e required / fail-on-missing-token, vs Actions
   budget reality.

## Cold-session bootstrap
```bash
git fetch origin
git switch claude/critical-fixes-f1-f3
# read: docs/design/self-transfer-guard-spec.md, backup-data-revision-spec.md,
#       currency-freeze-integrity-spec.md
npm run typecheck && npm run lint && npm test   # baseline must be green first
```
Key anchors: `openCopy` `app/account/[id].tsx:171`; refines
`src/lib/validation.ts:78-85`; `signedDelta` `src/domain/balances.ts:17-26`;
`backupSignature` `src/domain/backupPolicy.ts:95-119`; backup bookkeeping
`src/features/backup/repository.ts:343-353`; auto-backup trigger
`app/_layout.tsx:79-85`; currencies `src/features/settings/repository.ts`
(`SUPPORTED_CURRENCIES`, 46 codes); widget formatter
`targets/widget/WidgetSummary.swift:73-84`; amount input
`src/components/ui/AmountKeypad.tsx`.

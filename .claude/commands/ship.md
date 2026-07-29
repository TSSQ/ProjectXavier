# /ship <feature or fix description>

Run the full stage-gated delivery train for ProjectXavier. **A stage that has
not PASSED closes the gate — never start the next stage past a failed or
incomplete one.** Update the dashboard at EVERY transition (protocol below).

## Ground rules (hard-won — do not skip)
- ALL work happens in the worktree `.claude/worktrees/fm-spike` on branch
  `claude/account-creation-spike`. `cd` into it explicitly in EVERY Bash
  command; the shell cwd silently resets. Never `git add -A` outside it.
- Design philosophy for anything touching the on-device model: probe first
  (see /probe), guard deterministically; the 3B model can't do arithmetic,
  dates, list discipline, or negative instructions.
- Memories to consult: `widget-build24-signing` (build recipe),
  `fm-probe-harness`, `pure-local-store-direction` (store checklist).

## Stages & gates
1. **Spec** — write `docs/design/<slug>-spec.md` (objective, scope + out-of-
   scope, concrete approach with real paths, testable acceptance criteria,
   constraints, edge cases). GATE: for product-shaped work (new UX, scope
   choices), pause and get the user's approval — AskUserQuestion if there's a
   genuine fork. Bug fixes with an obvious shape may auto-pass; say so.
2. **Implement** — implementer agent builds the spec (background OK). GATE:
   implementer reports typecheck+lint+test green (+ sim build if native).
3. **QA** — qa-tester agent on the diff, adversarial. GATE: PASS, or
   PASS-WITH-CONCERNS with every Major resolved (send fixes back to the SAME
   implementer agent via SendMessage; re-gate). FAIL loops until resolved.
   RECORD: append the qa-tester's **verbatim** verdict (verdict line + the
   gaps/risks it listed) to `docs/ship-runs/<slug>.md` under a `## QA` heading,
   including each rejection round — so a rejection is quotable in-repo later
   (see "Run record" below).
4. **Review** — reviewer agent, final read. GATE: APPROVE or
   APPROVE-WITH-NITS; apply substantive nits directly, note skipped ones.
   RECORD: append the reviewer's **verbatim** verdict to
   `docs/ship-runs/<slug>.md` under a `## Review` heading.
5. **Verify** — main agent re-runs `npm run typecheck && npm run lint &&
   npm test && npm run eval` in the worktree. GATE: all green, run by you,
   not claimed. `npm run eval` is the Tier-1 parse-quality gate (heuristic
   engine, no keys) from `evals/` — see `docs/design/parse-eval-pipeline-spec.md`.
6. **Commit + push** — stage ONLY the feature's files (named paths) AND the
   run record `docs/ship-runs/<slug>.md`, commit with a why-first message +
   `Co-Authored-By: Claude` + a `Ship-Run: <slug>` trailer (the trailer makes
   pipeline commits uniquely countable — `git log --grep='Ship-Run:'` — vs. the
   broad `Co-Authored-By: Claude` which is on every Claude-assisted commit incl.
   the scaffold). Push via SSH remote. GATE: push accepted.
7. **Build + upload** — invoke `/build`. GATE: UPLOAD SUCCEEDED with delivery
   UUID.
8. **Device confirm** — status `waiting`; tell the user exactly what to test.
   Mark passed only when the user confirms (or reports issues → new /triage).

## Run record (committed provenance — do not skip)
`<slug>` is the spec slug (same as `docs/design/<slug>-spec.md`). Keep a
`docs/ship-runs/<slug>.md` as the run's durable, committed record — the thing
that lets a future reader (or a portfolio page) trace what the pipeline
actually did without relying on ephemeral agent transcripts or the untracked
dashboard. Sections, appended as stages complete: `## Spec` (link), `## QA`
(verbatim verdict + each rejection round), `## Review` (verbatim verdict),
`## Verify` (the exact check output incl. `npm run eval`), `## Build` (delivery
UUID), `## Result`. See `docs/ship-runs/TEMPLATE.md`. It is committed in stage 6
alongside the feature and carries the `Ship-Run: <slug>` commit trailer.
The eval leaves its own committed provenance at `evals/results/<engine>.json`
(scores + git SHA + gate outcome, written by every `npm run eval*`).

## Dashboard protocol (every transition)
1. Edit `.claude/pipeline/state.json`: set the finishing stage's
   status/note/at, the next stage to `running`, keep `checks` fresh. On run
   completion, prepend a `history` entry (cap 12) and leave the run visible.
2. `node .claude/pipeline/render.mjs`
3. Redeploy the artifact: `Artifact` tool, file
   `.claude/pipeline/dashboard.html`, favicon `🚦`, and — CRITICAL — pass
   `url:` = `meta.dashboardUrl` from state.json so the user's bookmarked link
   updates in place. If `dashboardUrl` is null (first ever deploy this
   project), deploy fresh, then write the returned URL into `meta.dashboardUrl`.
4. Failures: set the stage `failed` with a plain-language note. The dashboard
   must never show a stage beyond a failed one as anything but `pending`.

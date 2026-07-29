# /audit [last | <run id> | <commit range> | pre-store]

Independent, cold-eyes verification of a COMPLETED run (or span of runs).
The auditor re-derives evidence from scratch; it does not re-read approvals.
Output: a CONFIRMED / DISCREPANCIES stamp on the dashboard, with receipts.

## Rules
- The auditor must be a FRESH agent (qa-tester type, read-only) with no
  involvement in the run being audited. Its prompt gets: the spec file, the
  commit range, the dashboard run entry (claims to check) — and explicit
  instructions to verify claims, not summarize them.
- Claims are only CONFIRMED by primary evidence the auditor produces itself:
  re-run checks (exit codes), git show/diff against the spec's acceptance
  criteria, grep for the specific fixes QA/review claimed (file:line must
  exist), test-count delta recomputed from the actual suites, and — if a
  build shipped — signing/entitlement spot checks (pbxproj settings, and the
  IPA in the scratchpad if it still exists; else ASC build presence via
  asc_builds.mjs).
- Scope `pre-store`: audit the WHOLE soak-period diff (build 17 lineage →
  HEAD) against the store checklist in memory `pure-local-store-direction`,
  security-lens included. Run this before the App Store submission.

## Flow
1. Resolve scope: default `last` = the most recent completed run in
   `.claude/pipeline/state.json` (or the active run if all stages ≤ push have
   passed). Collect its spec path, commit range, and every gate note (these
   are the CLAIMS under audit).
2. Launch the auditor with the claims list. Require a finding-by-finding
   table: claim → evidence produced → CONFIRMED / DISCREPANCY / UNVERIFIABLE
   (with why — e.g. scratchpad IPA gone).
3. Triage discrepancies honestly: real regressions → /triage or /ship a fix;
   stale/overwritten claims → correct the dashboard note; UNVERIFIABLE ≠
   failure, but say what would make it verifiable.
4. Stamp the dashboard: set `run.audit = { status: "confirmed" |
   "discrepancies", note: "<n claims, n confirmed, …>", at: ISO }` in
   state.json, `node .claude/pipeline/render.mjs`, redeploy the artifact to
   `meta.dashboardUrl`. Report the table summary + the stamp to the user.

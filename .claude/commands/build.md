# /build

Cut, verify, and upload a TestFlight build from the fm-spike worktree. Follows
the two-target recipe proven on build 24 — full detail in memory
`widget-build24-signing`. Update the pipeline dashboard per /ship's protocol
(stages: number → archive → export+verify → upload) if a run is active.

1. **Preflight**: `cd .claude/worktrees/fm-spike`; confirm branch
   `claude/phase2-byok`; working tree clean; checks green if not
   just verified. Confirm per-target Release signing is still in the pbxproj
   (CODE_SIGN_STYLE Manual, team CFVNU6RD8C, profiles "Project Xavier" /
   "Project Xavier Widget"); if prebuild wiped it, re-apply the python patch
   from the memory. Signing cert MUST be SHA1 598BFA17… (June-27-2027 expiry).
   **Before any archive** (this scheme — TestFlight — and a Beta-scheme
   direct-install archive both build from `node_modules` in place, so both
   need this): `npm ci` so `node_modules` is freshly installed with
   `patches/@react-native-ai+apple+*.patch` actually applied (`postinstall`
   now runs `patch-package --error-on-fail`, so a bad/stale patch fails the
   install loudly instead of silently shipping an unpatched binding), then
   `node evals/fm/check-sync.mjs`
   to confirm the installed `@react-native-ai/apple` binding's schema-order
   behavior still matches what the app/probe assume. Both must exit 0 before
   archiving — a stale, unpatched `node_modules` must never ship silently.
2. **FM eval preflight (REPORT-ONLY — does not block, DEV SPLIT ONLY)**:
   `bash evals/fm/build.sh` to (re)compile the probe, then `FM_PROBE_PATH=$PWD/evals/fm/probe
   node evals/run-eval.mjs --engine=fm --n=5 --split=dev` (or `npm run
   eval:fm`, which now runs `--split=dev` by default — step 1b.1's B1) — N=5
   repeats per case for a pass-rate over the DEV split ONLY, graded against
   `evals/thresholds.json`. **Never run `--split=holdout` here or anywhere in
   `/build`** — the holdout split exists to be scored rarely and
   deliberately (see `evals/README.md`'s "Holdout discipline"), and
   `run-eval.mjs` refuses a holdout run without `--confirm-holdout` +
   `--purpose=...` for exactly this reason; a build preflight must never be
   the thing that silently burns a holdout look. Print the score table in the
   run regardless of PASS/FAIL; a threshold FAIL does NOT block the archive
   right now (see docs/design/parse-eval-pipeline-spec.md). SKIP (exit 0, no
   probe/no Apple Intelligence) is likewise just noted, never a gate.
   CONCRETE FLIP CRITERION (step 1b.1 — replaces the old `--n=5`/"all 39
   cases" wording, stale since the dataset grew to 150 with a dev/holdout
   split and the targets were restructured, see `evals/README.md`'s "Good
   enough" bar): re-tighten to a real GATE only once BOTH hold across 3
   consecutive builds' `--split=dev` `--n=5` runs — (a) the dev split's
   reliable-case parse-case/refusal-case rates have stayed at or above the
   existing ship-bar thresholds (`thresholds.model.parse` 0.80 /
   `thresholds.model.refusal` 0.85, comfortably clear of single-run noise),
   AND (b) `ledgerCorrect` (the restructured primary "good enough" target —
   `amountMinor` AND `sign` AND `dateISO` all correct) has stayed within 10
   points of its 0.95 target. Until then this step stays report-only.
   **Expected RED on refusal right now** (step 1b.1 QA/review fix round):
   refusal accuracy currently reads 0.80 < the 0.85 `thresholds.model.refusal`
   bar on `--split=all` (36/45), and 78.8% on dev — this is a KNOWN,
   already-documented gap (`evals/README.md`'s refusal-subtype breakdown: FM
   is weak specifically on `injection`/`finance-near-miss`), not a new
   regression to chase, and it's expected to stay red until the step 2/3
   refusal and amount work lands. Keep reporting it anyway — the point of a
   report-only red is to stay meaningful (a real NEW regression must still
   be visible against this known baseline), not to be silenced.
3. **Number**: `node <scratchpad>/asc_builds.mjs` (recreate per memory if the
   scratchpad is gone) → next = max+1. Bump `app.config.ts` buildNumber, the
   app's `ios/ProjectXavier/Info.plist` CFBundleVersion, AND the widget
   target's CURRENT_PROJECT_VERSION (Debug+Release) — app and appex versions
   must match. Commit the app.config bump; push.
4. **Archive** (background Bash; EXPO_PUBLIC_METRICS=1 for soak builds — OMIT
   for the store build): `xcodebuild -workspace ios/ProjectXavier.xcworkspace
   -scheme ProjectXavier -configuration Release -destination
   'generic/platform=iOS' archive` (no global signing overrides — per-target
   settings do the work).
5. **Export + verify**: `-exportArchive` with the ExportOptions.plist carrying
   `signingStyle manual` + the two-entry `provisioningProfiles` map. Then
   unzip the IPA and CHECK before upload: CFBundleVersion on both Info.plists,
   `PlugIns/XavierWidget.appex` present, `codesign -d --entitlements` shows
   the App Group on both binaries.
6. **Upload**: `xcrun altool --upload-app -t ios --apiKey "$ASC_API_KEY_ID"
   --apiIssuer "$ASC_ISSUER_ID"`. The ASC API Key ID + Issuer ID are NOT
   committed — read the real values from the private user memory
   `widget-build24-signing` (the `.p8` private key lives in
   `~/.appstoreconnect/private_keys/`, never in the repo). GATE: UPLOAD
   SUCCEEDED; report the Delivery UUID and what the user should test.

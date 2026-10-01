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
2. **FM eval preflight (REPORT-ONLY — does not block)**: `bash evals/fm/build.sh`
   to (re)compile the probe, then `FM_PROBE_PATH=$PWD/evals/fm/probe node
   evals/run-eval.mjs --engine=fm --n=5` (or `npm run eval:fm`) — N=5 repeats
   per case for a pass-rate, graded against `evals/thresholds.json`. Print the
   score table in the run regardless of PASS/FAIL; a threshold FAIL does NOT
   block the archive right now (see docs/design/parse-eval-pipeline-spec.md).
   SKIP (exit 0, no probe/no Apple Intelligence) is likewise just noted, never
   a gate. CONCRETE FLIP CRITERION — re-tighten to a real GATE only once: FM's
   `--n=5` reliable-case pass-rate has stayed ≥ 0.85 across 3 consecutive
   builds (comfortably clear of the 0.80 bar's single-run noise — fm.json has
   straddled it at 0.75–0.78). (The denominator mismatch between the
   single-run and `--n` gates — review nit #1 — is now reconciled: both grade
   `overallAccuracy`/the reliable-case fraction over ALL 39 cases; see
   `evals/score.mjs`'s `aggregate()` doc comment and
   `evals/run-eval.mjs`'s `gateAgainstThresholdsNRuns`.)
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

# /build

Cut, verify, and upload a TestFlight build from the fm-spike worktree. Follows
the two-target recipe proven on build 24 — full detail in memory
`widget-build24-signing`. Update the pipeline dashboard per /ship's protocol
(stages: number → archive → export+verify → upload) if a run is active.

1. **Preflight**: `cd .claude/worktrees/fm-spike`; confirm branch
   `claude/account-creation-spike`; working tree clean; checks green if not
   just verified. Confirm per-target Release signing is still in the pbxproj
   (CODE_SIGN_STYLE Manual, team CFVNU6RD8C, profiles "Project Xavier" /
   "Project Xavier Widget"); if prebuild wiped it, re-apply the python patch
   from the memory. Signing cert MUST be SHA1 598BFA17… (June-27-2027 expiry).
2. **FM eval preflight (REPORT-ONLY — does not block)**: `bash evals/fm/build.sh`
   to (re)compile the probe, then `FM_PROBE_PATH=$PWD/evals/fm/probe node
   evals/run-eval.mjs --engine=fm --n=5` (or `npm run eval:fm`) — N=5 repeats
   per case for a pass-rate, graded against `evals/thresholds.json`. Print the
   score table in the run regardless of PASS/FAIL; a threshold FAIL does NOT
   block the archive right now (see docs/design/parse-eval-pipeline-spec.md).
   SKIP (exit 0, no probe/no Apple Intelligence) is likewise just noted, never
   a gate. CONCRETE FLIP CRITERION — re-tighten to a real GATE only once BOTH
   hold: (a) FM's `--n=5` reliable-case pass-rate has stayed ≥ 0.85 across 3
   consecutive builds (comfortably clear of the 0.80 bar's single-run noise —
   fm.json has straddled it at 0.75–0.78), AND (b) the denominator mismatch
   between the single-run and `--n` gates is reconciled (review nit #1, flagged
   in `evals/run-eval.mjs`'s `gateAgainstThresholdsNRuns` doc-comment).
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

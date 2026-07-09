# Build spec — Xavier home-screen widget (launcher + spend-at-a-glance)

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`)._
_Scope decision 2026-07-09: option B — tap-to-talk launcher + this-period
income/expense on the medium size._

## Objective
A WidgetKit widget so Xavier is reachable from the home/lock screen: tapping
opens the assistant with the keyboard up; the medium widget also shows the
current month's income and expense, fed by an App-Group summary the app writes
on every data change. All data stays on-device (the App Group container is
still the device).

## Scope (in)
1. **Widget extension target** via `@bacons/apple-targets` (new devDependency):
   - `targets/widget/expo-target.config.js` — type `widget`, name `XavierWidget`,
     bundle id `com.projectxavier.app.widget`, App Group
     `group.com.projectxavier.app`, deployment target matching the app (26.0).
   - Swift/SwiftUI in `targets/widget/` (committed — NOT under any `ios/` dir):
     - **Small (systemSmall):** Xavier blob (SwiftUI-drawn: circle with the
       app's blue→purple `#5B8DEF→#7C5BEF` linear gradient, two dark rounded
       eyes + white catchlights, soft highlight — mirror the app icon), a
       one-line prompt ("Tell Xavier…"), dark ground `#0E1116`. Whole widget =
       one tap target → `projectxavier://?focus=1`.
     - **Medium (systemMedium):** Xavier blob left; right side shows
       "THIS MONTH" label + income (green `#33C27F`, `+` prefixed) and expense
       (red `#F2637E`, `−` prefixed) rows from the shared summary, formatted
       with the summary's currency. Two tap targets via `Link`: the blob/prompt
       area → `projectxavier://?focus=1`; a small camera glyph corner button →
       `projectxavier://?scan=1`.
     - **Lock screen (accessoryCircular + accessoryInline):** circular = mini
       Xavier glyph; inline = "Tell Xavier". Tap → `projectxavier://?focus=1`.
   - Timeline: single entry, `.never` reload policy — the app pushes reloads
     explicitly. Placeholder/snapshot renders with zeroed summary.
   - Summary decoding: widget reads
     `<AppGroup>/widget-summary.json` via
     `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`;
     tolerant decoding (missing/corrupt file → show the launcher layout without
     numbers, never crash). Fields: `{ "version": 1, "periodLabel": "July 2026",
     "incomeMinor": 200000, "expenseMinor": 948258, "currency": "SGD",
     "updatedAt": 1720500000000 }`.
2. **App-side summary writer** `src/features/widget/summary.ts`:
   - `updateWidgetSummary()` — computes the CURRENT CALENDAR MONTH totals over
     all active accounts (reuse `totalsForRange` + the month-range helper the
     dashboard/period domain already has), writes the JSON to the App Group
     container, then asks WidgetKit to reload.
   - App Group file access from JS: expo-file-system's shared-container path
     (`Paths.appleSharedContainers` / equivalent for the installed SDK 54 API).
     If the installed expo-file-system version doesn't expose shared
     containers, extend the existing local-module pattern instead (see 3) with
     a `writeSummary(json)` function — pick whichever is available, note which.
   - Call sites: after every successful transaction create/update/delete
     (feature layer — `src/features/transactions/repository.ts` callers or the
     repository itself; pick the narrowest chokepoint and document it), after
     restore-from-backup, and on the app-background transition (reuse the
     existing single AppState listener in `_layout.tsx`). Errors swallowed
     (widget staleness must never break a save).
3. **Widget reload bridge** — tiny local Expo module `modules/widget-bridge/`
   (same layout as `modules/apple-ocr`): `reloadWidgets()` calling
   `WidgetCenter.shared.reloadAllTimelines()`. iOS-only, no-op elsewhere
   (requireOptionalNativeModule, same seam pattern as AppleOcr).
4. **Deep-link handling** in `app/(tabs)/index.tsx`:
   - `?focus=1` → focus the input (inputRef exists) after mount/navigation.
   - `?scan=1` → invoke the existing `onScan` action sheet.
   - Use `useLocalSearchParams` on the index route; guard so params fire once
     per navigation (not on every re-render); must not disturb normal opens.
5. **Entitlements/config** in `app.config.ts`:
   - `ios.entitlements['com.apple.security.application-groups'] =
     ['group.com.projectxavier.app']`.
   - Plugin entry for `@bacons/apple-targets`.
6. **Prebuild**: after config changes, run `npx expo prebuild -p ios --clean`
   ONCE to materialize the target, then `npx pod-install`. Verify afterward:
   AppIcon regenerated from assets/icon.png (new icon), Info.plist
   CFBundleVersion matches app.config buildNumber, permission strings intact,
   `modules/apple-ocr` + `modules/widget-bridge` linked, and the workspace
   builds for simulator. Document any manual `ios/` state that prebuild wiped.

## Out of scope
- Siri/App Intents hands-free logging (phase 2).
- Widget configurability (intents/edit), per-account scoping, period selection
  — the summary is always current-calendar-month, all accounts.
- StandBy/watch surfaces.
- Android widgets/quick settings.
- Store-profile/signing setup (user-side portal work; build/signing handled at
  pipeline time, not in this diff).

## Requirements / acceptance criteria
- [ ] `npx tsc`, lint, full test suite green. Summary computation has BDD
      coverage if any new pure logic is added (month-range + totals reuse
      existing tested domain — new pure helpers, if any, get scenarios).
- [ ] Simulator build compiles BOTH targets:
      `xcodebuild -workspace ios/ProjectXavier.xcworkspace -scheme ProjectXavier -configuration Debug -destination 'generic/platform=iOS Simulator' build`.
- [ ] Widget target compiles with deployment target 26.0 and links WidgetKit;
      no third-party deps inside the widget.
- [ ] `updateWidgetSummary()` writes valid JSON to the App Group path and is
      wired at the documented chokepoints; a write failure never surfaces to
      the user.
- [ ] Deep links: `projectxavier://?focus=1` focuses the assistant input;
      `?scan=1` opens the scan action sheet; a plain open behaves as today.
      (Sim-verifiable via `xcrun simctl openurl booted ...` for routing; the
      keyboard focus itself is device/manual.)
- [ ] Widget renders in the widget gallery with placeholder data (manual, once
      signing exists — flag as deferred).
- [ ] `targets/` committed; nothing under `ios/` is the only copy of any new
      source (prebuild-safe by construction).
- [ ] `git status --ignored` shows no new source silently ignored (the
      `.gitignore` anchoring from the OCR round should already cover this —
      verify for `targets/`).

## Constraints & conventions
- Widget SwiftUI: hardcode the dark-theme brand colors (the widget is
  intentionally theme-fixed like the app icon; document this). Text in white /
  muted grays; income/expense use the app's semantic green/red hexes.
- Comment discipline; framework-free domain untouched; guardrail #6 n/a (no
  untrusted input; the summary is app-authored — the WIDGET still decodes
  defensively since file corruption is possible).
- New npm deps: exactly `@bacons/apple-targets` (devDependency). Nothing else.
- Money formatting in Swift: minor units → major with the currency code
  prefix, matching `formatMoney`'s "SGD 1,234.56" shape closely enough for a
  widget (document any divergence).

## Edge cases & risks
- **Prebuild --clean wipes local ios/ state** — the acceptance item above
  exists because this repo builds from the checked-out ios/. Anything that
  regresses (icon, Info.plist strings) must be caught in this diff, not at
  archive time.
- **expo-file-system shared-container API availability** on the installed SDK
  — verify before writing code; fall back to the native-module route.
- **Widget process cannot use Drizzle/SQLite** — it must never import app JS;
  it reads only the JSON file.
- **First run after install**: no summary file yet → widget shows launcher
  layout; the first app open writes one (call updateWidgetSummary once at
  startup too — cheap).
- **Currency changes**: summary carries its own currency; a currency change in
  Settings should trigger a rewrite (call site in the settings currency save).
- **Deep-link param loops**: `?focus=1` must not re-fire on tab switches
  (expo-router keeps params — clear them or track a consumed ref).

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/xavier-widget-spec.md` on `claude/account-creation-spike`
> (worktree `.claude/worktrees/fm-spike`). Then qa-tester, then reviewer.
> TestFlight build waits on the user's portal work (App Group + widget
> bundle id + two provisioning profiles).

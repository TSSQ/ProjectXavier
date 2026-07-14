# Spec: hide widget totals when locked via Data Protection (build 37)

## Objective

Build 36 shipped `.privacySensitive()` on the widget's income/expense amounts,
but on a real device (build 36 confirmed installed) the numbers are STILL
visible on the locked Today View. Root cause: `.privacySensitive()` redaction is
**gated by a device setting** — Settings → Face ID & Passcode → *Allow Access
When Locked → Lock Screen Widgets*. When that's on (the default), iOS grants the
widget full data access while locked and the modifier is a no-op. It's not
app-controllable, so `.privacySensitive()` can't be relied on.

Use Apple's documented, settings-independent mechanism instead: give the widget
extension the **Data Protection capability** (`NSFileProtectionComplete`).
Per Apple's WidgetKit security guide, WidgetKit then **hides the widget's
content and shows a placeholder while the device is passcode-locked**, restoring
the real content on unlock. This is what the *other* (fully-greyed) widget in
the user's locked-Today-View screenshot is doing.

Behavior after the fix (what the user asked for — keep totals, make privacy work):
- **Unlocked** → Income/Expense totals, exactly as today.
- **Locked** (Today View / StandBy) → whole card greys to the placeholder; no
  numbers. Independent of any user setting.

## Scope

**IN:**
1. Add the Data Protection entitlement to the widget target
   (`targets/widget/expo-target.config.js`, `entitlements` block):
   `'com.apple.developer.default-data-protection': 'NSFileProtectionComplete'`.
   This regenerates into `targets/widget/generated.entitlements` on prebuild and
   is applied to the `XavierWidget.appex`.
2. Keep the existing `.privacySensitive()` on the amount `Text` (harmless;
   belt-and-suspenders — it additionally redacts if a user *has* turned the
   Lock-Screen-Widgets setting off).

**OUT:**
- Any change to the unlocked appearance or to what the widget computes.
- File-level `NSFileProtectionComplete` on the shared `widget-summary.json`:
  `src/features/widget/summary.ts` writes via `expo-file-system`'s `File.write`,
  which exposes no protection-class API — not feasible without a native module.
  Noted as a possible follow-up ONLY if the extension entitlement proves
  insufficient on device.
- The app's DB/backup protection (already SQLCipher), M4/M5/M7.
- Dropping the totals entirely (the fallback if this doesn't work on device).

## Approach

`targets/widget/expo-target.config.js` — add one key to the existing
`entitlements` object (next to the app-group entitlement):

```js
entitlements: {
  'com.apple.security.application-groups': ['group.com.projectxavier.app'],
  // Data Protection: WidgetKit hides the widget's content and shows a
  // placeholder while the device is passcode-locked (Apple WidgetKit security
  // guide). Reliable, unlike .privacySensitive() which the "Lock Screen
  // Widgets" Allow-Access-When-Locked setting can bypass. Totals return on unlock.
  'com.apple.developer.default-data-protection': 'NSFileProtectionComplete',
},
```

No app/domain code changes. `WidgetSummary.swift` / `XavierWidget.swift` already
render a placeholder (`WidgetSummary.placeholder`, zeroed) and a nil-fallback
launcher, so WidgetKit's locked placeholder has something sane to show.

## Acceptance criteria
1. **Node suite green** — `npm run typecheck && npm run lint && npm test`
   (519 tests unchanged; this is native config only, no JS/domain change).
2. **Config correct** — the entitlement key/value present in
   `expo-target.config.js`; after prebuild it appears in the widget's
   `generated.entitlements` and in the `XavierWidget.appex` embedded
   entitlements (verified at the /build IPA check).
3. **Signs & uploads** — build 37 archives + exports with the new entitlement.
   ⚠️ BUILD RISK (corrected after QA — treat as a PRE-FLIGHT, not a reactive
   fallback): the "Data Protection" capability likely must be **explicitly
   enabled on the widget's App ID** (`com.projectxavier.app.widget`) in the
   Apple Developer portal, and the "Project Xavier Widget" provisioning profile
   regenerated, BEFORE archiving. It is NOT reliably a default-on capability,
   and because @bacons/apple-targets writes the `.entitlements` file directly
   (no Xcode SystemCapabilities bookkeeping in the pbxproj), there is no
   auto-enable side effect. Release-manager: check the portal App ID first; if
   Data Protection isn't enabled, enable it + regenerate the profile (may need
   the user's portal access) rather than waiting for a signing failure. Do NOT
   silently drop the entitlement to get a green build.
4. **Device confirm (build 37)** — the ONLY real proof (lock state can't be
   simulated): on the locked Today View / StandBy the widget's numbers are
   hidden (card greys to placeholder); unlocking shows the real totals again.

## Constraints
- Worktree `.claude/worktrees/fm-spike`; SSH remote; commit only this fix's
  files (`expo-target.config.js`, this spec).
- `src/domain/**` untouched (nothing to keep framework-free here).
- Do not regress build 36's other fixes (metrics-off, debug guards, Face ID
  string, mic removal).

## Edge cases
- **Before first unlock after reboot:** `NSFileProtectionComplete` content is
  unavailable until first unlock — widget shows placeholder until the user
  unlocks once. Acceptable (stricter, matches the DB-key threat model).
- **Lock Screen Widgets setting OFF:** `.privacySensitive()` also engages;
  redaction is still correct (both mechanisms agree on "hide when locked").
- **Timeline caching:** WidgetKit's data-protection hiding is applied by the
  system at display time, so a timeline generated while unlocked is still
  hidden when the device locks (this is the advantage over a self-managed
  file-protection approach, which the cached entry would defeat).
- **App Group write still works unlocked:** the summary write path is unchanged;
  data protection on the *widget* extension doesn't affect the *app* writing the
  file when unlocked.

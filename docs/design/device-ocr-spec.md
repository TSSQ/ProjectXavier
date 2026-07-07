# Build spec — On-device OCR for receipt scanning (Apple Vision)

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`)._

## Objective
Receipt scanning is dead today: `onScan` works up to `recognize(uri)`, which is
the throwing `unconfiguredRecognizer` stub. Implement a real on-device
`TextRecognizer` backed by Apple Vision (`VNRecognizeTextRequest`) so a
photographed receipt becomes text locally, then flows through the existing
parse ladder. The image never leaves the device (see the boundary rationale in
`src/features/ocr/recognizer.ts`).

## Scope (in)
- A **local Expo module** `modules/apple-ocr/` exposing
  `recognizeText(imageUri: string): Promise<string>` from Swift.
- `src/features/ocr/appleVisionRecognizer.ts` — a `TextRecognizer` adapter over
  that module.
- Wire it into the assistant screen's `onScan` (replacing
  `unconfiguredRecognizer`) with honest error copy.
- A sim-driveable debug screen `app/debug-ocr.tsx` + hidden Settings row
  (mirrors the `debug-fm` pattern), since the camera can't run on the simulator.

## Out of scope (do not touch/build)
- ML Kit / Android — `TextRecognizer` stays the seam for a future Android impl.
- Any change to the parse ladder, `deviceParsePrompt.ts`, or receipt-specific
  parse tuning (long OCR text through FM may need prompt work — separate task).
- Receipt image storage, cropping/scanning UI, multi-page receipts.
- No third-party OCR dependency (`@react-native-ml-kit/*`,
  `react-native-text-recognition`, etc.).

## Approach (concrete)

**1. Local Expo module `modules/apple-ocr/`** (Expo SDK 54 local-module layout;
autolinked via the `modules/` directory, no config-plugin needed):
- `modules/apple-ocr/expo-module.config.json` — `{ "platforms": ["apple"], "apple": { "modules": ["AppleOcrModule"] } }`
- `modules/apple-ocr/ios/AppleOcr.podspec`
- `modules/apple-ocr/ios/AppleOcrModule.swift` — ExpoModulesCore `Module` with
  one AsyncFunction `recognizeText(_ uri: String)`:
  - Accept `file://` URIs (that's what `expo-image-picker` returns); reject
    others with a clear error.
  - `VNImageRequestHandler(url:)` + `VNRecognizeTextRequest`;
    `recognitionLevel = .accurate`, `usesLanguageCorrection = true`.
  - Run the request off the main thread (Vision is CPU-heavy); resolve with
    observations' `topCandidates(1)` strings joined by `\n` in natural
    (top-to-bottom) order — Vision returns reading order; do not re-sort.
  - Empty result → resolve `""` (the TS layer decides the UX), errors → reject.
- `modules/apple-ocr/index.ts` — typed JS entry re-exporting the native module
  (`requireNativeModule('AppleOcr')`).
- Deployment target: match the app (iOS 26 per `app.config.ts`) in the podspec.

**2. Adapter `src/features/ocr/appleVisionRecognizer.ts`:**
```ts
import { TextRecognizer } from './recognizer';
export const appleVisionRecognizer: TextRecognizer = {
  recognize: (uri) => AppleOcr.recognizeText(uri),
};
```
Keep it thin; `Platform.OS === 'ios'` is guaranteed today, but export via a
`getRecognizer()` that returns `appleVisionRecognizer` on iOS and
`unconfiguredRecognizer` otherwise, so the seam stays explicit.

**3. Screen wiring (`app/(tabs)/index.tsx` `onScan`):**
- Swap `unconfiguredRecognizer.recognize(...)` for the resolved recognizer.
- The current catch replies "Receipt scanning needs the on-device OCR module
  (dev build)." — now wrong. New behavior:
  - OCR throws → `setReply("I couldn't read that photo — try a clearer shot.")`
  - OCR returns empty/whitespace text → `setReply("I couldn't find any text on
    that receipt — try a clearer shot.")` and do NOT call `runParse`.
  - Non-empty text → `runParse(text)` exactly as today.

**4. Debug screen `app/debug-ocr.tsx`** (copy the `debug-fm.tsx` conventions,
including the metrics gating and the Settings → Developer row):
- Button: pick image from the photo library (`launchImageLibraryAsync` — works
  on the simulator; drag a receipt photo onto the sim to seed the library).
- Runs the recognizer, shows: elapsed ms, character count, and the raw text in
  a scrollable monospace block; errors shown inline.
- A "Parse this" button that routes the text through the same `runParse` used
  by the assistant is NOT needed — out of scope.
- Add the Settings row next to the existing "Debug: On-device AI" row, gated by
  the same metrics flag.

## Requirements / acceptance criteria
- [ ] `modules/apple-ocr` compiles into the app via `npx pod-install` +
      autolinking; no new npm dependencies in `package.json` (ExpoModulesCore
      is already present via `expo`).
- [ ] On a simulator build: open Settings → Developer → Debug: OCR, pick a
      photo containing printed text, and the recognized text renders with
      latency. (Verify with an actual sim run, not just compilation.)
- [ ] Empty-text and error paths in `onScan` show the new copy and never call
      `runParse` with empty text.
- [ ] Camera flow unchanged otherwise: permissions prompt, cancel handling,
      busy state, OCR text → `runParse` → normal draft card.
- [ ] `unconfiguredRecognizer` still exists and still throws (it remains the
      non-iOS default and the test seam).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green (the BDD suite
      must not import the native module — keep it out of `src/domain/`).
- [ ] Light/dark: the debug screen uses theme tokens (it's dev-only, but don't
      hardcode dark hex).

## Constraints & conventions
- **Framework-free domain untouched** — nothing OCR-related goes in
  `src/domain/`; the native boundary lives in `modules/` + `src/features/ocr/`.
- Swift style: single-purpose module, no state; comments explain constraints
  (e.g. why reading order isn't re-sorted), not narration.
- `NSCameraUsageDescription` / photo-library usage strings: check
  `app.config.ts` `ios.infoPlist` — camera string should already exist (onScan
  ships today); ADD the photo-library string if missing
  (`NSPhotoLibraryUsageDescription`) since the debug screen introduces library
  access.
- Treat OCR output as untrusted input (guardrail #6): it already flows into
  `runParse`, which validates — do not add any new path that trusts raw text.
- After adding the module, `npx pod-install` (or `pod install` in `ios/`) must
  be run so the workspace picks it up — note this in your report; the TestFlight
  pipeline builds from the checked-out `ios/` directory.

## Edge cases & risks
- **HEIC images** (default iPhone camera format): `VNImageRequestHandler(url:)`
  handles HEIC natively — no conversion needed; don't add one.
- **Rotated images:** pass the CGImagePropertyOrientation from the image URL if
  EXIF is present (`VNImageRequestHandler(url:options:)` respects EXIF by
  default — verify with a rotated test photo rather than adding manual code).
- **Large images:** Vision handles downscaling internally; do not resize in JS.
- **Concurrency:** `onScan` already guards with `busy`; the module itself must
  still be safe if called twice (each call creates its own request handler —
  stateless).
- **Simulator vs device:** Vision's `.accurate` path works on simulator (CPU),
  slower than device — fine for the debug screen.
- **Prebuild drift:** `ios/` is gitignored; the `modules/` directory IS
  committed. Anyone re-running `npx expo prebuild` regains the pod via
  autolinking — do not hand-edit anything under `ios/` beyond `pod install`
  effects.

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/device-ocr-spec.md` on `claude/account-creation-spike`
> (worktree `.claude/worktrees/fm-spike`). Then run qa-tester on the diff,
> then reviewer. Verify with a simulator build before reporting done.

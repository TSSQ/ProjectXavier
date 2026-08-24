#!/usr/bin/env node
/**
 * Add a `Beta` build configuration to the hand-maintained iOS project so a
 * second, fully separate copy of the app can live on the same device as the
 * App Store build.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ios/` is gitignored and hand-maintained (we never run `expo prebuild`), so
 * anything done to the Xcode project lives only on one machine's disk. The
 * manual signing setup already has this problem. This script makes the beta
 * configuration reproducible instead: run it, and the project gains the Beta
 * configuration; lose the project, run it again.
 *
 * WHAT IT DOES
 * ------------
 * iOS allows exactly one app per bundle identifier, so the App Store build and
 * a test build collide unless the identifier differs. This clones the *Release*
 * configuration into a new `Beta` configuration on all three configuration
 * lists (app target, widget target, project) and overrides only identity:
 *
 *   app      com.projectxavier.app        -> com.projectxavier.beta
 *   widget   com.projectxavier.app.widget -> com.projectxavier.beta.widget
 *   group    group.com.projectxavier.app  -> group.com.projectxavier.beta
 *   iCloud   iCloud.com.projectxavier.app -> iCloud.com.projectxavier.beta
 *   name     Xavier                       -> Xavier Beta
 *
 * Release and Debug are untouched, so `-configuration Release` still produces
 * exactly the App Store build it produced before this script ran.
 *
 * WHY THE iCLOUD CONTAINER IS *NOT* SHARED
 * ----------------------------------------
 * Sharing it looks attractive — it is the only bridge that could carry real
 * data into the beta, since the backup feature has no file export/import. It
 * is also a data-loss bug waiting to happen. `icloud.list()` reads every
 * backup file in the container regardless of which app wrote it, and
 * `createBackupUnlocked` then prunes to `KEEP = 3`. Two apps sharing one
 * container means whichever backs up more often silently evicts the other's
 * backups — and auto-backup runs hourly. At the time of writing there were
 * exactly 3 real backups in the container, i.e. already at the prune limit:
 * the beta's first backup would have destroyed one.
 *
 * So the beta gets its own container and starts empty. It can then churn its
 * own backups forever without touching the real ones. If you ever do want real
 * data in it, copy a backup file into
 * ~/Library/Mobile Documents/iCloud~com~projectxavier~beta/Documents/ on the
 * Mac — a one-time copy with no ongoing link, which the beta will then offer
 * to restore. Do NOT point the beta at the production container to achieve it.
 *
 * SIGNING
 * -------
 * Release uses manual signing with the distribution profiles. Beta switches to
 * automatic development signing so Xcode can register the two new App IDs, the
 * App Group and the iCloud container itself — run the build with
 * `-allowProvisioningUpdates`. Manual signing would mean creating all of that
 * in the developer portal by hand first.
 *
 * Idempotent: re-running is a no-op once the Beta configuration is present.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PBX = join(ROOT, 'ios/ProjectXavier.xcodeproj/project.pbxproj');

const APP_ID = 'com.projectxavier.beta';
const WIDGET_ID = 'com.projectxavier.beta.widget';
const GROUP = 'group.com.projectxavier.beta';
const CONTAINER = 'iCloud.com.projectxavier.beta';
const DISPLAY = 'Xavier Beta';
const TEAM = 'CFVNU6RD8C';

/** Fixed UUIDs so re-running cannot mint duplicates. pbxproj wants 24 hex. */
const NEW = {
  app: 'BE7A000000000000000A0001',
  widget: 'BE7A000000000000000A0002',
  project: 'BE7A000000000000000A0003',
};

/** The three configuration lists, and the Release config each one clones. */
const LISTS = [
  { list: '13B07F931A680F5B00A75B9A', release: '13B07F951A680F5B00A75B9A', kind: 'app' },
  { list: '83CBB9FA1A601CBA00E9B192', release: '83CBBA211A601CBA00E9B192', kind: 'project' },
  { list: 'XX2B21CD64E75C82196683XX', release: 'XX9DA38EAA4D00A040A783XX', kind: 'widget' },
];

/** Extract the full `UUID /* Release *​/ = { ... };` block by brace matching. */
function blockFor(src, uuid) {
  const start = src.indexOf(`\t\t${uuid} /* Release */ = {`);
  if (start === -1) throw new Error(`Release config ${uuid} not found — project layout changed`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const end = src.indexOf(';', i) + 1;
  return { text: src.slice(start, end), end };
}

/** Keys like `"CODE_SIGN_IDENTITY[sdk=iphoneos*]"` contain regex metacharacters. */
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace `key = value;` inside a buildSettings block, or insert it. */
function setSetting(block, key, value) {
  const re = new RegExp(`(\\n\\t+)${esc(key)} = [^;]*;`);
  if (re.test(block)) return block.replace(re, `$1${key} = ${value};`);
  return block.replace(/(\n\t+buildSettings = \{)/, `$1\n\t\t\t\t${key} = ${value};`);
}

/** Drop a setting entirely (manual-signing leftovers that break automatic). */
function dropSetting(block, key) {
  return block.replace(new RegExp(`\\n\\t+${esc(key)} = [^;]*;`), '');
}

function overridesFor(kind, block) {
  let b = block;
  if (kind === 'app' || kind === 'widget') {
    b = setSetting(b, 'PRODUCT_BUNDLE_IDENTIFIER', kind === 'app' ? APP_ID : WIDGET_ID);
    // Both beta entitlements live under ios/, NOT targets/widget/. The
    // bacons/apple-targets config plugin scans targets/<name>/ and aborts with
    // "Found more than one '*.entitlements' file" if a second one appears
    // beside generated.entitlements — which is exactly what a beta file there
    // does. ios/ is generated territory anyway, and this script rewrites both.
    b = setSetting(
      b,
      'CODE_SIGN_ENTITLEMENTS',
      kind === 'app'
        ? 'ProjectXavier/ProjectXavier.beta.entitlements'
        : 'ProjectXavier/XavierWidget.beta.entitlements'
    );
    // Automatic signing registers the new App IDs / group / container for us.
    b = setSetting(b, 'CODE_SIGN_STYLE', 'Automatic');
    b = setSetting(b, 'DEVELOPMENT_TEAM', TEAM);
    b = setSetting(b, 'CODE_SIGN_IDENTITY', '"Apple Development"');
    // The SDK-scoped key is the one that actually applies to an iOS build, and
    // it is set independently of the plain key. Leaving it at "Apple
    // Distribution" makes the build fail with "conflicting provisioning
    // settings" — automatically signed for development, distribution identity
    // manually specified — which is exactly what happened the first time.
    b = setSetting(b, '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"', '"Apple Development"');
    b = dropSetting(b, 'PROVISIONING_PROFILE_SPECIFIER');
    b = dropSetting(b, '"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"');
    b = dropSetting(b, 'PROVISIONING_PROFILE');
  }
  if (kind === 'app') b = setSetting(b, 'XAVIER_DISPLAY_NAME', `"${DISPLAY}"`);
  return b;
}

function main() {
  if (!existsSync(PBX)) {
    console.error(`No project at ${PBX} — nothing to patch.`);
    process.exit(1);
  }
  let src = readFileSync(PBX, 'utf8');

  if (src.includes('/* Beta */')) {
    console.log('Beta configuration already present — nothing to do.');
    return;
  }

  // 1. Clone each Release configuration into a Beta one.
  for (const { release, kind } of LISTS) {
    const { text, end } = blockFor(src, release);
    let beta = text
      .replace(`${release} /* Release */ = {`, `${NEW[kind]} /* Beta */ = {`)
      .replace(/\n(\t+)name = Release;/, '\n$1name = Beta;');
    beta = overridesFor(kind, beta);
    src = src.slice(0, end) + '\n' + beta + src.slice(end);
  }

  // 2. Register Beta on each configuration list.
  //
  //    Anchor on the DEFINITION, not the reference. Every list id appears
  //    twice: once as `buildConfigurationList = <id> /* ... */;` inside
  //    PBXProject/PBXNativeTarget, and once as the real
  //    `<id> /* ... */ = { isa = XCConfigurationList; ... }` block. The
  //    reference comes first in the file, so a loose pattern matches there and
  //    then runs forward to the first `buildConfigurations = (` it can find —
  //    which is a DIFFERENT target's list. That silently piled all three Beta
  //    configs onto the app target and left the project and widget with none,
  //    so CONFIGURATION fell back to the default (Release) and every pod
  //    product was sought in Release-iphoneos.
  //
  //    The definition is the only occurrence at exactly two leading tabs
  //    followed by ` = {`, so match that and splice within its own block.
  for (const { list, kind } of LISTS) {
    const marker = `\n\t\t${list} /* Build configuration list`;
    const start = src.indexOf(marker);
    if (start === -1) throw new Error(`Configuration list ${list} not found`);
    const open = src.indexOf('buildConfigurations = (', start);
    const close = src.indexOf(');', open);
    if (open === -1 || close === -1 || close < open) {
      throw new Error(`Malformed configuration list ${list}`);
    }
    const entry = `\t\t\t\t${NEW[kind]} /* Beta */,\n`;
    src = src.slice(0, close) + entry + '\t\t\t' + src.slice(close);
  }

  writeFileSync(PBX, src);
  console.log('Beta configuration added to app, widget and project.');

  // 3. Entitlements: same shape as production, different identifiers.
  const appEnt = join(ROOT, 'ios/ProjectXavier/ProjectXavier.beta.entitlements');
  writeFileSync(
    appEnt,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.developer.icloud-container-environment</key>
    <string>Production</string>
    <key>com.apple.developer.icloud-container-identifiers</key>
    <array>
      <string>${CONTAINER}</string>
    </array>
    <key>com.apple.developer.icloud-services</key>
    <array>
      <string>CloudDocuments</string>
    </array>
    <key>com.apple.developer.ubiquity-container-identifiers</key>
    <array>
      <string>${CONTAINER}</string>
    </array>
    <key>com.apple.security.application-groups</key>
    <array>
      <string>${GROUP}</string>
    </array>
  </dict>
</plist>
`
  );

  // Repair an earlier run that put this in targets/widget/ and broke the
  // apple-targets plugin.
  const stray = join(ROOT, 'targets/widget/beta.entitlements');
  if (existsSync(stray)) {
    rmSync(stray);
    console.log('Removed stray targets/widget/beta.entitlements.');
  }

  const widgetEnt = join(ROOT, 'ios/ProjectXavier/XavierWidget.beta.entitlements');
  writeFileSync(
    widgetEnt,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.developer.default-data-protection</key>
    <string>NSFileProtectionComplete</string>
    <key>com.apple.security.application-groups</key>
    <array>
      <string>${GROUP}</string>
    </array>
  </dict>
</plist>
`
  );
  console.log('Beta entitlements written (app + widget).');

  // 4. Display name via a build setting, so Release keeps saying "Xavier".
  const plist = join(ROOT, 'ios/ProjectXavier/Info.plist');
  let p = readFileSync(plist, 'utf8');
  if (p.includes('<string>Xavier</string>')) {
    p = p.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)Xavier(<\/string>)/,
      '$1$(XAVIER_DISPLAY_NAME)$2'
    );
    writeFileSync(plist, p);
    // Non-Beta configurations must still resolve the variable to "Xavier".
    let s = readFileSync(PBX, 'utf8');
    for (const uuid of ['13B07F941A680F5B00A75B9A', '13B07F951A680F5B00A75B9A']) {
      const { text, end } = (() => {
        const start = s.indexOf(`\t\t${uuid} /*`);
        let i = s.indexOf('{', start);
        let d = 0;
        for (; i < s.length; i++) {
          if (s[i] === '{') d++;
          else if (s[i] === '}') {
            d--;
            if (d === 0) break;
          }
        }
        return { text: s.slice(start, s.indexOf(';', i) + 1), end: s.indexOf(';', i) + 1 };
      })();
      if (!text.includes('XAVIER_DISPLAY_NAME')) {
        const patched = setSetting(text, 'XAVIER_DISPLAY_NAME', 'Xavier');
        s = s.slice(0, end - text.length) + patched + s.slice(end);
      }
    }
    writeFileSync(PBX, s);
    console.log('Display name parameterised (Release stays "Xavier").');
  }

  // 5. CocoaPods generates one xcconfig per configuration and only knows
  //    Debug/Release by default. Without declaring Beta, a `-configuration
  //    Beta` build dies with "The sandbox is not in sync with the
  //    Podfile.lock" while pointing at Release-iphoneos paths. The Podfile is
  //    inside the gitignored ios/ tree, so it gets patched here rather than
  //    edited by hand and lost.
  const podfile = join(ROOT, 'ios/Podfile');
  let needsPodInstall = false;
  if (existsSync(podfile)) {
    let pf = readFileSync(podfile, 'utf8');
    if (!pf.includes("'Beta' => :release")) {
      pf = pf.replace(
        /(target 'ProjectXavier' do\n)/,
        `$1  # Beta is a release-flavoured configuration (scripts/apply-beta-config.mjs).\n  project 'ProjectXavier', 'Beta' => :release\n\n`
      );
      writeFileSync(podfile, pf);
      needsPodInstall = true;
      console.log('Podfile: declared Beta as a release-flavoured configuration.');
    }
  }

  // 6. A scheme pins a configuration per action, and ProjectXavier.xcscheme
  //    pins ArchiveAction to Release. Passing `-configuration Beta` to
  //    `xcodebuild archive` does NOT reliably override that: the Pods script
  //    phases read $CONFIGURATION from the environment and saw Release, so the
  //    app looked for its pod products in Release-iphoneos while everything
  //    else was told Beta. Symptoms were "sandbox is not in sync with the
  //    Podfile.lock" and then a wall of "no such module 'Expo'" /
  //    "module map file ... Release-iphoneos ... not found". A dedicated
  //    scheme with every action on Beta removes the ambiguity.
  const schemeDir = join(ROOT, 'ios/ProjectXavier.xcodeproj/xcshareddata/xcschemes');
  const baseScheme = join(schemeDir, 'ProjectXavier.xcscheme');
  const betaScheme = join(schemeDir, 'ProjectXavierBeta.xcscheme');
  if (existsSync(baseScheme)) {
    const s = readFileSync(baseScheme, 'utf8').replace(
      /buildConfiguration = "(Debug|Release)"/g,
      'buildConfiguration = "Beta"'
    );
    writeFileSync(betaScheme, s);
    console.log('Scheme ProjectXavierBeta written (all actions on Beta).');
  }

  console.log(`
Next:${needsPodInstall ? '\n  (cd ios && pod install)     # generates the Beta xcconfig' : ''}
  xcodebuild -workspace ios/ProjectXavier.xcworkspace \\
    -scheme ProjectXavierBeta -destination 'generic/platform=iOS' \\
    -allowProvisioningUpdates archive -archivePath /tmp/XavierBeta.xcarchive

  xcrun devicectl device install app --device <name> \\
    /tmp/XavierBeta.xcarchive/Products/Applications/ProjectXavier.app
`);
}

main();

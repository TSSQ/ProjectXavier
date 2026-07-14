/**
 * @bacons/apple-targets config for the Xavier home/lock-screen widget.
 *
 * Everything under this directory is synced verbatim into the Xcode project
 * on `expo prebuild` (via a PBXFileSystemSynchronizedRootGroup) — it is never
 * copied into `ios/`, so it survives `expo prebuild --clean`. See
 * docs/design/xavier-widget-spec.md for the full brief.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'XavierWidget',
  // Matches the app's deploymentTarget (app.config.ts / expo-build-properties)
  // — Apple Foundation Models already require iOS 26 on this app.
  deploymentTarget: '26.0',
  bundleIdentifier: 'com.projectxavier.app.widget',
  // Explicit (rather than relying on the plugin's appGroupsByDefault mirroring)
  // so the App Group id is visible right here, next to the bundle id.
  entitlements: {
    'com.apple.security.application-groups': ['group.com.projectxavier.app'],
    // Data Protection: WidgetKit hides the widget's content and shows a
    // placeholder while the device is passcode-locked (Apple WidgetKit security
    // guide). Reliable, unlike .privacySensitive() which the "Lock Screen
    // Widgets" Allow-Access-When-Locked setting can bypass. Totals return on unlock.
    'com.apple.developer.default-data-protection': 'NSFileProtectionComplete',
  },
};

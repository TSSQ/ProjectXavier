# iOS: UIScene lifecycle adoption (hand-maintained ios/)

`ios/` is gitignored and hand-maintained, so this file is the only versioned
copy of the change. **Re-apply it if `ios/` is ever regenerated** (for
example by `expo prebuild`), or every build made with Xcode 27 / the iOS 27
SDK will be terminated at launch.

## Why

From the iOS 27 SDK on, an app that still creates its window in
`application(_:didFinishLaunchingWithOptions:)` (no UIScene lifecycle) is
killed at launch: `EXC_BREAKPOINT` in
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Beta 125 and
126 (the first Xcode 27 builds) crashed on every open. Beta 127, with this
change, launches.

## Info.plist (`ios/ProjectXavier/Info.plist`)

```xml
<key>UIApplicationSceneManifest</key>
<dict>
  <key>UIApplicationSupportsMultipleScenes</key>
  <false/>
  <key>UISceneConfigurations</key>
  <dict>
    <key>UIWindowSceneSessionRoleApplication</key>
    <array>
      <dict>
        <key>UISceneConfigurationName</key>
        <string>Default Configuration</string>
        <key>UISceneDelegateClassName</key>
        <string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>
      </dict>
    </array>
  </dict>
</dict>
```

## `ios/ProjectXavier/AppDelegate.swift`

The app delegate still builds the React Native factory once per process;
`SceneDelegate` (same file, so no Xcode project edits) creates the window,
starts React Native in it, and forwards URL opens and universal links to the
app delegate's existing handlers (Expo subscribers + `RCTLinkingManager`). A
cold-start deep link is passed as `launchOptions[.url]` so
`Linking.getInitialURL` keeps working.

```swift
import Expo
import React
import ReactAppDependencyProvider

// UIScene lifecycle (required from the iOS 27 SDK on: an app built with it
// that still creates its window in didFinishLaunching is terminated at launch
// in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption — Beta
// 125/126). The app delegate still builds the React Native factory once per
// process; SceneDelegate below owns the window and starts React Native in it.
// Info.plist's UIApplicationSceneManifest points at SceneDelegate.

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  // Set by SceneDelegate. Kept because libraries still look up the key window
  // through the app delegate.
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Not an override: Expo 54's ExpoAppDelegate doesn't declare it.
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }

  // Linking API — SceneDelegate forwards scene URL opens here, so Expo's
  // subscribers and RCTLinkingManager both still see every URL.
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links — forwarded from SceneDelegate the same way.
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // A cold-start deep link arrives on the scene now, not in the launch
    // options — hand it to React Native the old way so Linking.getInitialURL
    // still returns it.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      options[.openInPlace] = context.options.openInPlace
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
```

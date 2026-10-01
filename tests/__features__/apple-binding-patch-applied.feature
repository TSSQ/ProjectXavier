Feature: The installed @react-native-ai/apple binding must carry the step 1a.5 patch
  `node_modules` is gitignored and rebuilt by every fresh `npm install`/`npm
  ci`. `patches/@react-native-ai+apple+0.12.0.patch` (applied by
  patch-package's `postinstall` hook) is what makes the native schema parser
  honour a pinned `"x-order"` field order instead of Swift `Dictionary`'s
  per-call-randomized one (step 1a.5) — every on-device contract in this repo
  depends on it. A stale/unpatched install (e.g. `postinstall` silently
  failed, or someone ran `npm install --ignore-scripts`) must never ship
  silently: this guard fails LOUDLY, with an actionable message, rather than
  leaving the app to quietly regress to alphabetical field order.

  Scenario: The installed binding's source still contains the patch's deterministic-order function and its "x-order" read
    When I read the installed @react-native-ai/apple binding's AppleLLMImpl.swift
    Then it should still define the orderedPropertyNames function
    And it should still read the "x-order" key from the schema dictionary
    And a missing patch should fail with a message telling me to run npm install to apply patches/

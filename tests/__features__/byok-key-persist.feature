Feature: BYOK key verify-on-save
  src/domain/byokKeyPersist.ts's setAndVerifySecret is the safety net behind
  docs/design/byok-keychain-persist-spec.md: a Keychain write can silently
  no-op on a real device (confirmed root cause), so a save must never be
  reported as successful without reading the value back and confirming it
  actually persisted.

  Scenario: A write that persists resolves without error
    Given a fake secret store where writes persist
    When I save the key "sk-live-abc123" under "byok_key_openai"
    Then the save should succeed
    And the store should hold "sk-live-abc123" under "byok_key_openai"

  Scenario: A write that silently no-ops (read-back is null) throws a key-free error
    Given a fake secret store where writes silently fail
    When I save the key "sk-live-abc123" under "byok_key_openai"
    Then the save should throw a ByokKeyPersistError
    And the thrown error message should not contain "sk-live-abc123"

  Scenario: A write whose read-back mismatches the written value throws
    Given a fake secret store where writes read back a different value
    When I save the key "sk-live-abc123" under "byok_key_openai"
    Then the save should throw a ByokKeyPersistError
    And the thrown error message should not contain "sk-live-abc123"

  Scenario: setSecret itself rejecting (a native Keychain throw) still surfaces as a ByokKeyPersistError
    Given a fake secret store whose setSecret rejects
    When I save the key "sk-live-abc123" under "byok_key_openai"
    Then the save should throw a ByokKeyPersistError
    And the thrown error message should not contain "sk-live-abc123"

  Scenario: getSecret itself rejecting (a native Keychain throw on read-back) still surfaces as a ByokKeyPersistError
    Given a fake secret store whose getSecret rejects
    When I save the key "sk-live-abc123" under "byok_key_openai"
    Then the save should throw a ByokKeyPersistError
    And the thrown error message should not contain "sk-live-abc123"

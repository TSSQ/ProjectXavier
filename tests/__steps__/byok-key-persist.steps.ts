import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { setAndVerifySecret, ByokKeyPersistError, SecretStore } from '../../src/domain/byokKeyPersist';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/byok-key-persist.feature')
);

type StoreKind =
  | 'persists'
  | 'silently-fails'
  | 'reads-back-different'
  | 'setSecret-rejects'
  | 'getSecret-rejects';

function fakeStore(kind: StoreKind): SecretStore & { backing: Map<string, string> } {
  const backing = new Map<string, string>();
  return {
    backing,
    async setSecret(key: string, value: string): Promise<void> {
      switch (kind) {
        case 'persists':
        case 'getSecret-rejects':
          backing.set(key, value);
          return;
        case 'silently-fails':
          // Write no-ops — nothing is actually stored, mirroring the
          // on-device WHEN_UNLOCKED_THIS_DEVICE_ONLY failure.
          return;
        case 'reads-back-different':
          backing.set(key, `${value}-corrupted`);
          return;
        case 'setSecret-rejects':
          // A real expo-secure-store call throwing/rejecting rather than
          // silently no-op'ing — a real on-device failure mode.
          throw new Error('native keychain write failed');
      }
    },
    async getSecret(key: string): Promise<string | null> {
      if (kind === 'getSecret-rejects') {
        throw new Error('native keychain read failed');
      }
      return backing.get(key) ?? null;
    },
  };
}

defineFeature(feature, (test) => {
  test('A write that persists resolves without error', ({ given, when, then }) => {
    let store: ReturnType<typeof fakeStore>;
    let key: string;
    let value: string;
    let error: unknown;

    given('a fake secret store where writes persist', () => {
      store = fakeStore('persists');
    });

    when(/^I save the key "(.*)" under "(.*)"$/, async (v: string, k: string) => {
      value = v;
      key = k;
      error = undefined;
      try {
        await setAndVerifySecret(store, key, value);
      } catch (e) {
        error = e;
      }
    });

    then('the save should succeed', () => {
      expect(error).toBeUndefined();
    });

    then(/^the store should hold "(.*)" under "(.*)"$/, (v: string, k: string) => {
      expect(store.backing.get(k)).toBe(v);
    });
  });

  test('A write that silently no-ops (read-back is null) throws a key-free error', ({
    given,
    when,
    then,
  }) => {
    let store: ReturnType<typeof fakeStore>;
    let key: string;
    let value: string;
    let error: unknown;

    given('a fake secret store where writes silently fail', () => {
      store = fakeStore('silently-fails');
    });

    when(/^I save the key "(.*)" under "(.*)"$/, async (v: string, k: string) => {
      value = v;
      key = k;
      error = undefined;
      try {
        await setAndVerifySecret(store, key, value);
      } catch (e) {
        error = e;
      }
    });

    then('the save should throw a ByokKeyPersistError', () => {
      expect(error).toBeInstanceOf(ByokKeyPersistError);
    });

    then(/^the thrown error message should not contain "(.*)"$/, (secret: string) => {
      expect((error as Error).message).not.toContain(secret);
    });
  });

  test('A write whose read-back mismatches the written value throws', ({ given, when, then }) => {
    let store: ReturnType<typeof fakeStore>;
    let key: string;
    let value: string;
    let error: unknown;

    given('a fake secret store where writes read back a different value', () => {
      store = fakeStore('reads-back-different');
    });

    when(/^I save the key "(.*)" under "(.*)"$/, async (v: string, k: string) => {
      value = v;
      key = k;
      error = undefined;
      try {
        await setAndVerifySecret(store, key, value);
      } catch (e) {
        error = e;
      }
    });

    then('the save should throw a ByokKeyPersistError', () => {
      expect(error).toBeInstanceOf(ByokKeyPersistError);
    });

    then(/^the thrown error message should not contain "(.*)"$/, (secret: string) => {
      expect((error as Error).message).not.toContain(secret);
    });
  });

  test('setSecret itself rejecting (a native Keychain throw) still surfaces as a ByokKeyPersistError', ({
    given,
    when,
    then,
  }) => {
    let store: ReturnType<typeof fakeStore>;
    let key: string;
    let value: string;
    let error: unknown;

    given('a fake secret store whose setSecret rejects', () => {
      store = fakeStore('setSecret-rejects');
    });

    when(/^I save the key "(.*)" under "(.*)"$/, async (v: string, k: string) => {
      value = v;
      key = k;
      error = undefined;
      try {
        await setAndVerifySecret(store, key, value);
      } catch (e) {
        error = e;
      }
    });

    then('the save should throw a ByokKeyPersistError', () => {
      expect(error).toBeInstanceOf(ByokKeyPersistError);
    });

    then(/^the thrown error message should not contain "(.*)"$/, (secret: string) => {
      expect((error as Error).message).not.toContain(secret);
    });
  });

  test('getSecret itself rejecting (a native Keychain throw on read-back) still surfaces as a ByokKeyPersistError', ({
    given,
    when,
    then,
  }) => {
    let store: ReturnType<typeof fakeStore>;
    let key: string;
    let value: string;
    let error: unknown;

    given('a fake secret store whose getSecret rejects', () => {
      store = fakeStore('getSecret-rejects');
    });

    when(/^I save the key "(.*)" under "(.*)"$/, async (v: string, k: string) => {
      value = v;
      key = k;
      error = undefined;
      try {
        await setAndVerifySecret(store, key, value);
      } catch (e) {
        error = e;
      }
    });

    then('the save should throw a ByokKeyPersistError', () => {
      expect(error).toBeInstanceOf(ByokKeyPersistError);
    });

    then(/^the thrown error message should not contain "(.*)"$/, (secret: string) => {
      expect((error as Error).message).not.toContain(secret);
    });
  });
});

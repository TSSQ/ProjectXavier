/**
 * Root layout. Initialises the database and gates behind a biometric unlock —
 * no financial data renders until the device is unlocked.
 */
import '../src/lib/aiPolyfills';
import '../global.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme, useColorScheme } from 'nativewind';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PortalProvider } from '@gorhom/portal';
import { migrate } from '../src/db/migrate';
import { postDueOccurrences } from '../src/features/recurring/repository';
import { requireBiometricUnlock } from '../src/lib/secureStore';
import {
  getTheme,
  getBiometricLock,
  getBiometricLockCached,
} from '../src/features/settings/repository';
import { useThemeColors } from '../src/theme/useThemeColors';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/ui/Button';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Refs mirror the latest state/setting for use inside the AppState listener,
  // which is registered once — reading React state there would close over
  // stale values. `bioLockRef` is refreshed on every `active` transition (and
  // at startup) rather than read async at background-time, because the
  // background handler must call setUnlocked(false) synchronously, before the
  // app-switcher snapshot is taken; awaiting a setting read would be too late.
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const bioLockRef = useRef(true);
  // Guards against overlapping biometric prompts (e.g. a cold-start prompt
  // still in flight when a fast background→active cycle fires resume again).
  const promptInFlightRef = useRef(false);
  // iOS reaches 'background' via an intermediate 'inactive' hop (active →
  // inactive → background, and back the same way on resume), so `prev` at
  // the moment `nextState` finally settles on 'active'/'background' is
  // usually 'inactive', not 'active'/'background' themselves. This ref tracks
  // whether the app actually reached 'background' (as opposed to merely
  // passing through 'inactive' for the Face ID sheet, a permission dialog, or
  // Control Center) so resume only re-prompts after a real backgrounding.
  const enteredBackgroundRef = useRef(false);

  const runUnlockPrompt = useCallback(async () => {
    if (promptInFlightRef.current) return;
    promptInFlightRef.current = true;
    try {
      const success = await requireBiometricUnlock();
      setUnlocked(success);
    } finally {
      promptInFlightRef.current = false;
    }
  }, []);

  // Opportunistic auto-backup + biometric re-lock when the app moves to/from
  // the background. A single listener drives both so there's exactly one
  // AppState subscription.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const prev = appStateRef.current;
        appStateRef.current = nextState;
        if (
          (prev === 'active') &&
          (nextState === 'background' || nextState === 'inactive')
        ) {
          // Lazy import to avoid load-order issues; errors are swallowed inside maybeAutoBackup.
          import('../src/features/backup/repository')
            .then(({ maybeAutoBackup }) => maybeAutoBackup())
            .catch(() => {/* swallow */});
        }

        // Re-lock strictly once the app reaches 'background' (not merely
        // 'inactive', which also covers the Face ID sheet itself, permission
        // dialogs, and Control Center — those return to 'active' without ever
        // reaching 'background', so treating 'inactive' as a lock trigger
        // would immediately re-prompt and loop). Locking here also means the
        // splash — not live data — is what shows in the app switcher
        // snapshot. Must be synchronous (no await) so it lands before the OS
        // takes the snapshot; that's why the toggle is read from a ref
        // rather than fetched here.
        if (nextState === 'background') {
          enteredBackgroundRef.current = true;
          // The repository's synchronous cache wins over the ref: it reflects
          // a Settings toggle flipped moments ago, where the ref only catches
          // up on the next 'active' transition.
          if (getBiometricLockCached() ?? bioLockRef.current) setUnlocked(false);
        }

        if (nextState === 'active') {
          // Keep the cached toggle fresh for the next backgrounding. Fire-
          // and-forget: a toggle flipped and immediately backgrounded before
          // this resolves is a known, accepted stale-by-one edge case.
          getBiometricLock()
            .then((v) => { bioLockRef.current = v; })
            .catch(() => {/* keep previous cached value */});

          // Resume from a real backgrounding re-prompts if still locked.
          if (enteredBackgroundRef.current) {
            enteredBackgroundRef.current = false;
            if (!unlockedRef.current) runUnlockPrompt();
          }
        }
      },
    );
    return () => subscription.remove();
  }, [runUnlockPrompt]);

  useEffect(() => {
    (async () => {
      try {
        await migrate();
        // Post any missed recurring occurrences in background; non-fatal.
        postDueOccurrences(Date.now()).catch((e) =>
          console.error('Recurring post failed:', e),
        );
        // Resolve the Appearance preference alongside the other startup loads
        // (behind the same splash gate) and apply it before the app renders,
        // so there's no dark→light flash after the splash clears.
        colorScheme.set(await getTheme());
        setReady(true);
        // The user-persisted toggle (Settings → Require Face ID on launch)
        // decides whether the biometric prompt gates the app; default ON.
        const bioLock = await getBiometricLock();
        bioLockRef.current = bioLock;
        if (bioLock) {
          // Routed through runUnlockPrompt so its in-flight guard also
          // covers a fast background/resume racing the cold-start prompt.
          await runUnlockPrompt();
        } else {
          setUnlocked(true);
        }
      } catch (e) {
        // Never leave the user stuck on the splash — surface what failed.
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Startup failed:', e);
        setStartupError(msg);
      }
    })();
  }, [runUnlockPrompt]);

  if (startupError) {
    return <Splash message={`Startup failed: ${startupError}`} />;
  }

  if (!ready || !unlocked) {
    return (
      <Splash
        message={ready ? 'Locked — authenticate to continue' : 'Preparing…'}
        onUnlock={ready ? runUnlockPrompt : undefined}
      />
    );
  }

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <PortalProvider>
          <DynamicStatusBar />
          <Stack screenOptions={{ headerShown: false }} />
        </PortalProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

function DynamicStatusBar() {
  const { colorScheme: scheme } = useColorScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function Splash({
  message,
  onUnlock,
}: {
  message: string;
  /** Retries the biometric prompt. Omitted while the app is still starting. */
  onUnlock?: () => void;
}) {
  const c = useThemeColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={c.primary} />
      <Text style={{ color: c.muted, marginTop: 12 }}>{message}</Text>
      {onUnlock && (
        <Button
          title="Unlock"
          onPress={onUnlock}
          accessibilityLabel="Unlock"
          className="mt-5 px-6"
        />
      )}
    </View>
  );
}

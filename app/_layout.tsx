/**
 * Root layout. Initialises the database and gates behind a biometric unlock —
 * no financial data renders until the device is unlocked.
 */
import '../src/lib/aiPolyfills';
import '../global.css';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme, useColorScheme } from 'nativewind';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PortalProvider } from '@gorhom/portal';
import { migrate } from '../src/db/migrate';
import { postDueOccurrences } from '../src/features/recurring/repository';
import { requireBiometricUnlock } from '../src/lib/secureStore';
import { getTheme, getBiometricLock } from '../src/features/settings/repository';
import { useThemeColors } from '../src/theme/useThemeColors';
import { ThemeProvider } from '../src/theme/ThemeProvider';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Opportunistic auto-backup when the app moves to the background.
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
      },
    );
    return () => subscription.remove();
  }, []);

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
        setUnlocked(bioLock ? await requireBiometricUnlock() : true);
      } catch (e) {
        // Never leave the user stuck on the splash — surface what failed.
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Startup failed:', e);
        setStartupError(msg);
      }
    })();
  }, []);

  if (startupError) {
    return <Splash message={`Startup failed: ${startupError}`} />;
  }

  if (!ready || !unlocked) {
    return (
      <Splash
        message={ready ? 'Locked — authenticate to continue' : 'Preparing…'}
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

function Splash({ message }: { message: string }) {
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
    </View>
  );
}

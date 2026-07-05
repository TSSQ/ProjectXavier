/**
 * Root layout. Initialises the database, gates behind a biometric unlock, and
 * then behind authentication — no financial data renders until the device is
 * unlocked AND a Supabase session exists.
 */
import '../global.css';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme, useColorScheme } from 'nativewind';
import type { Session } from '@supabase/supabase-js';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PortalProvider } from '@gorhom/portal';
import { migrate } from '../src/db/migrate';
import { postDueOccurrences } from '../src/features/recurring/repository';
import { requireBiometricUnlock, hasAuthedBefore, markAuthed } from '../src/lib/secureStore';
import { getSession, onAuthChange } from '../src/features/auth/repository';
import { getTheme, getBiometricLock } from '../src/features/settings/repository';
import { SignIn } from '../src/features/auth/SignIn';
import { useThemeColors } from '../src/theme/useThemeColors';
import { ThemeProvider } from '../src/theme/ThemeProvider';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // True when there's no live session but this device has authenticated
  // before (offline-grace) — e.g. an expired token that couldn't refresh
  // because there's no network. See src/domain/authGate.ts.
  const [offlineGrace, setOfflineGrace] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
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
        const bioLock = await getBiometricLock();
        setUnlocked(bioLock ? await requireBiometricUnlock() : true);
        const startupSession = await getSession();
        setSession(startupSession);
        if (startupSession) {
          // Normal online start — (re)set the marker for future offline grace.
          void markAuthed();
        } else {
          // No live session: only fall back to SignIn if this device has
          // never authenticated before (see src/domain/authGate.ts).
          setOfflineGrace(await hasAuthedBefore());
        }
        setAuthChecked(true);
      } catch (e) {
        // Never leave the user stuck on the splash — surface what failed.
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Startup failed:', e);
        setStartupError(msg);
      }
    })();
    // Keep the gate in sync with sign-in / sign-out / token refresh.
    return onAuthChange((nextSession, event) => {
      setSession(nextSession);
      if (nextSession) setOfflineGrace(false);
      else if (event === 'SIGNED_OUT') setOfflineGrace(false);
    });
  }, []);

  if (startupError) {
    return <Splash message={`Startup failed: ${startupError}`} />;
  }

  if (!ready || !unlocked || !authChecked) {
    return (
      <Splash
        message={ready ? 'Locked — authenticate to continue' : 'Preparing…'}
      />
    );
  }

  if (!session && !offlineGrace) {
    return (
      <>
        <DynamicStatusBar />
        <SignIn />
      </>
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

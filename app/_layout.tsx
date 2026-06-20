/**
 * Root layout. Initialises the database, gates behind a biometric unlock, and
 * then behind authentication — no financial data renders until the device is
 * unlocked AND a Supabase session exists.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { migrate } from '../src/db/migrate';
import { requireBiometricUnlock } from '../src/lib/secureStore';
import { getSession, onAuthChange } from '../src/features/auth/repository';
import { SignIn } from '../src/features/auth/SignIn';
import { colors } from '../src/theme/tokens';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      await migrate();
      setReady(true);
      setUnlocked(await requireBiometricUnlock());
      setSession(await getSession());
      setAuthChecked(true);
    })();
    // Keep the gate in sync with sign-in / sign-out / token refresh.
    return onAuthChange(setSession);
  }, []);

  if (!ready || !unlocked || !authChecked) {
    return (
      <Splash
        message={ready ? 'Locked — authenticate to continue' : 'Preparing…'}
      />
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar style="light" />
        <SignIn />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

function Splash({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textMuted, marginTop: 12 }}>{message}</Text>
    </View>
  );
}

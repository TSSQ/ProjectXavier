/**
 * Root layout. Initialises the database and gates the app behind a biometric
 * unlock before rendering any financial data.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { migrate } from '../src/db/migrate';
import { requireBiometricUnlock } from '../src/lib/secureStore';
import { colors } from '../src/theme/tokens';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    (async () => {
      await migrate();
      setReady(true);
      setUnlocked(await requireBiometricUnlock());
    })();
  }, []);

  if (!ready || !unlocked) {
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
        <Text style={{ color: colors.textMuted, marginTop: 12 }}>
          {ready ? 'Locked — authenticate to continue' : 'Preparing…'}
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

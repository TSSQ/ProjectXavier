/**
 * Email-OTP sign-in screen. Step 1: enter email → we send a code. Step 2: enter
 * the code → session established. Rendered by the root layout whenever there is
 * no active session.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { defaultAvatar } from '../../theme/assets';
import { colors, spacing, radius, typography } from '../../theme/tokens';
import { isSupabaseConfigured } from '../../lib/supabase';
import { requestEmailOtp, verifyEmailOtp } from './repository';

export function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestEmailOtp(email);
      setStep('code');
    } catch {
      setError('Could not send a code. Check the email and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(email, code);
      // On success the auth listener in the root layout swaps to the app.
    } catch {
      setError('That code did not match. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Avatar source={defaultAvatar} size={96} />
        <Text style={styles.title}>ProjectXavier</Text>
        <Text style={styles.subtitle}>
          {step === 'email'
            ? 'Sign in with your email — we’ll send you a code.'
            : `Enter the code we sent to ${email}.`}
        </Text>
      </View>

      {!isSupabaseConfigured && (
        <Text style={styles.warn}>
          Supabase isn’t configured. Set EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.
        </Text>
      )}

      {step === 'email' ? (
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          editable={!busy}
          onSubmitEditing={sendCode}
          returnKeyType="send"
        />
      ) : (
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          editable={!busy}
          onSubmitEditing={verify}
          returnKeyType="done"
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={styles.button}
        onPress={step === 'email' ? sendCode : verify}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {step === 'email' ? 'Send code' : 'Verify'}
          </Text>
        )}
      </Pressable>

      {step === 'code' && !busy && (
        <Pressable onPress={() => setStep('email')}>
          <Text style={styles.link}>Use a different email</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center', gap: spacing.lg },
  header: { alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  warn: { color: colors.negative, textAlign: 'center', fontSize: typography.caption },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.body,
  },
  error: { color: colors.negative, textAlign: 'center', fontSize: typography.caption },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: typography.body },
  link: { color: colors.textMuted, textAlign: 'center', fontSize: typography.caption },
});

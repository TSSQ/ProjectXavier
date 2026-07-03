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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { AssistantAvatar } from '../../components/AssistantAvatar';
import { Button } from '../../components/ui/Button';
import { isSupabaseConfigured } from '../../lib/supabase';
import { requestEmailOtp, verifyEmailOtp } from './repository';
import { colors } from '../../theme/tokens';

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
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 bg-bg px-6 justify-center" style={{ gap: 24 }}>
        <View className="items-center" style={{ gap: 8 }}>
          <AssistantAvatar size={88} />
          <Text className="text-text text-[28px] font-extrabold mt-2">ProjectXavier</Text>
          <Text className="text-muted text-center px-6">
            {step === 'email'
              ? 'Sign in with your email — we’ll send you a code.'
              : `Enter the code we sent to ${email}.`}
          </Text>
        </View>

        {!isSupabaseConfigured && (
          <Text className="text-negative text-center text-xs">
            Supabase isn’t configured. Set EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.
          </Text>
        )}

        {step === 'email' ? (
          <TextInput
            className="bg-surface text-text rounded-md px-4 py-3.5 text-base"
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
            className="bg-surface text-text rounded-md px-4 py-3.5 text-base text-center tracking-[8px]"
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

        {error && <Text className="text-negative text-center text-xs">{error}</Text>}

        <Button
          title={step === 'email' ? 'Send code' : 'Verify'}
          loading={busy}
          onPress={step === 'email' ? sendCode : verify}
        />

        {step === 'code' && !busy && (
          <Pressable onPress={() => setStep('email')}>
            <Text className="text-muted text-center text-xs">Use a different email</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Assistant home — the "lazy" entry point: an avatar and a text box. The user
 * describes an expense ("12 bucks lunch at Joe's") or snaps a receipt; the AI
 * proxy parses it, and the pure assistant logic decides whether to save it, ask
 * a clarifying question, or block until an account exists. A manual-entry option
 * is always available for users who prefer forms.
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
import { Feather } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '../../src/components/Avatar';
import { defaultAvatar, icons } from '../../src/theme/assets';
import { colors, spacing, radius, typography } from '../../src/theme/tokens';
import { parseExpense } from '../../src/features/ai/client';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts } from '../../src/features/accounts/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import { unconfiguredRecognizer } from '../../src/features/ocr/recognizer';
import { getAccessToken } from '../../src/features/auth/repository';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";
// Cap on how many recent payees we hint to the model (cost control).
const MAX_PAYEE_HINTS = 50;

export default function AssistantScreen() {
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(GREETING);
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  const [busy, setBusy] = useState(false);

  async function runParse(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPending(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setReply('Your session expired — please sign in again.');
        return;
      }
      // Ground the parse in the user's existing data so the model maps to real
      // entities. Payees are capped to keep the prompt cheap as the list grows.
      const [accounts, categories, payees] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
      ]);
      const parsed = await parseExpense(
        {
          text: text.trim(),
          categories: categories.map((c) => c.name),
          payees: payees.slice(0, MAX_PAYEE_HINTS).map((p) => p.name),
          accounts: accounts.filter((a) => !a.archived).map((a) => a.name),
        },
        token
      );
      const outcome = interpret(parsed, { accounts });
      setReply(outcome.message);
      if (outcome.kind === 'confirm') setPending(outcome.draft);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parseExpense failed:', e);
      // Surface the reason during setup; soften once everything is wired.
      setReply(`Couldn't parse that — ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  const onSend = async () => {
    const text = draft;
    setDraft('');
    await runParse(text);
  };

  const onConfirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await saveAssistantDraft(pending);
      setPending(null);
      setReply('Saved! Anything else?');
    } catch {
      setReply("I couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onScan = async () => {
    if (busy) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setReply('I need camera access to scan a receipt.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;
    setBusy(true);
    try {
      // On-device OCR turns the photo into text; only the text hits the proxy.
      const text = await unconfiguredRecognizer.recognize(shot.assets[0].uri);
      await runParse(text);
    } catch {
      setReply('Receipt scanning needs the on-device OCR module (dev build).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.avatarBlock}>
        <Avatar source={defaultAvatar} size={140} />
        <Text style={styles.reply}>{reply}</Text>
        {busy && <ActivityIndicator color={colors.primary} />}
        {pending && !busy && (
          <Pressable style={styles.confirmButton} onPress={onConfirm}>
            <Text style={styles.confirmText}>Save</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.inputRow}>
        <Pressable
          style={styles.iconButton}
          onPress={onScan}
          accessibilityLabel="Scan receipt"
        >
          <Feather name={icons.camera} color={colors.text} size={20} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Describe an expense…"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={onSend}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable style={styles.sendButton} onPress={onSend} accessibilityLabel="Send">
          <Feather name={icons.send} color="#fff" size={20} />
        </Pressable>
      </View>

      <Link href="/accounts" style={styles.manualLink}>
        Prefer to type it in? Add manually
      </Link>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  avatarBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  reply: {
    color: colors.text,
    fontSize: typography.heading,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  confirmText: { color: '#fff', fontWeight: '600', fontSize: typography.body },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.pill,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.body,
  },
  sendButton: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.pill,
  },
  manualLink: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    fontSize: typography.caption,
  },
});

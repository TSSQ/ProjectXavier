/**
 * Assistant home — the "lazy" entry point: an avatar and a text box. The user
 * describes an expense ("12 bucks lunch at Joe's") and the assistant parses it,
 * asking clarifying questions for anything missing. A manual-entry option is
 * always available for users who prefer forms.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Avatar } from '../../src/components/Avatar';
import { defaultAvatar, icons } from '../../src/theme/assets';
import { colors, spacing, radius, typography } from '../../src/theme/tokens';

export default function AssistantScreen() {
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(
    "Hi, I'm Xavier. Tell me about an expense, or snap a receipt."
  );

  const onSend = () => {
    if (!draft.trim()) return;
    // Phase 2: POST to the AI proxy (src/features/ai/client.ts), then either
    // save the parsed transaction or ask a clarifying question.
    setReply(`Got it — I'll log: “${draft.trim()}”. (AI parsing lands in Phase 2.)`);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.avatarBlock}>
        <Avatar source={defaultAvatar} size={140} />
        <Text style={styles.reply}>{reply}</Text>
      </View>

      <View style={styles.inputRow}>
        <Pressable style={styles.iconButton} accessibilityLabel="Scan receipt">
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

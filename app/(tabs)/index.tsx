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
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { AssistantAvatar } from '../../src/components/AssistantAvatar';
import { Bubble } from '../../src/components/ui/Bubble';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { icons } from '../../src/theme/assets';
import { parseExpense } from '../../src/features/ai/client';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts } from '../../src/features/accounts/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import { unconfiguredRecognizer } from '../../src/features/ocr/recognizer';
import { getAccessToken } from '../../src/features/auth/repository';
import { formatMoney } from '../../src/domain/money';
import { Account } from '../../src/domain/types';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";
// Cap on how many recent payees we hint to the model (cost control).
const MAX_PAYEE_HINTS = 50;

export default function AssistantScreen() {
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(GREETING);
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
      const [accts, categories, payees] = await Promise.all([
        listAccounts(),
        listCategories(),
        listPayees(),
      ]);
      setAccounts(accts);
      const parsed = await parseExpense(
        {
          text: text.trim(),
          categories: categories.map((c) => c.name),
          payees: payees.slice(0, MAX_PAYEE_HINTS).map((p) => p.name),
          accounts: accts.filter((a) => !a.archived).map((a) => a.name),
        },
        token
      );
      const outcome = interpret(parsed, { accounts: accts });
      setReply(outcome.message);
      if (outcome.kind === 'confirm') setPending(outcome.draft);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parseExpense failed:', e);
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

  const onDiscard = () => {
    setPending(null);
    setReply('No problem — discarded. What else?');
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
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 bg-bg px-5 pt-14 pb-4">
        <View className="items-center mb-4">
          <AssistantAvatar size={96} />
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
          <Bubble from="ai">
            {pending ? "Here's what I'll log — look good?" : reply}
          </Bubble>

          {pending && (
            <DraftCard draft={pending} accounts={accounts} onSave={onConfirm} onDiscard={onDiscard} />
          )}

          {busy && <ActivityIndicator color="#5B8DEF" />}
        </ScrollView>

        <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
          <Pressable
            className="w-11 h-11 rounded-pill bg-surfaceAlt items-center justify-center"
            onPress={onScan}
            accessibilityLabel="Scan receipt"
          >
            <Feather name={icons.camera} color="#F2F5F9" size={20} />
          </Pressable>
          <TextInput
            className="flex-1 bg-surface text-text rounded-pill px-4 py-3 text-base"
            value={draft}
            onChangeText={setDraft}
            placeholder="Describe an expense…"
            placeholderTextColor="#9AA4B2"
            onSubmitEditing={onSend}
            returnKeyType="send"
            editable={!busy}
          />
          <Pressable
            className="w-11 h-11 rounded-pill bg-primary items-center justify-center"
            onPress={onSend}
            accessibilityLabel="Send"
          >
            <Feather name={icons.send} color="#fff" size={20} />
          </Pressable>
        </View>

        <Link
          href="/transactions"
          style={{ color: '#9AA4B2', textAlign: 'center', marginTop: 12, fontSize: 13 }}
        >
          Prefer to type it in? Add manually
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

function DraftCard({
  draft,
  accounts,
  onSave,
  onDiscard,
}: {
  draft: TransactionDraft;
  accounts: Account[];
  onSave: () => void;
  onDiscard: () => void;
}) {
  const accountName =
    accounts.find((a) => a.id === draft.accountId)?.name ?? 'Account';
  const money = formatMoney(draft.amount, draft.currency);
  const signed = draft.type === 'expense' ? `-${money}` : `+${money}`;
  const tone = draft.type === 'expense' ? 'text-negative' : 'text-positive';

  return (
    <Card className="border-[#33406e] self-stretch">
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="text-text text-sm font-bold capitalize">{draft.type}</Text>
        <Text className="text-primary text-[11px] font-bold border border-[#33406e] rounded-pill px-2 py-0.5">
          AI parsed
        </Text>
      </View>
      <Field k="Amount" v={signed} valueClassName={tone} />
      <Field k="Account" v={accountName} />
      <Field k="Category" v={draft.categoryName ?? '—'} />
      <Field k="Date" v={dateLabel(draft.occurredAt)} />
      <View className="flex-row mt-3" style={{ gap: 10 }}>
        <Button title="Discard" variant="ghost" onPress={onDiscard} className="flex-1" />
        <Button title="Save" variant="primary" onPress={onSave} className="flex-1" />
      </View>
    </Card>
  );
}

function Field({
  k,
  v,
  valueClassName = 'text-text',
}: {
  k: string;
  v: string;
  valueClassName?: string;
}) {
  return (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-muted text-[13px]">{k}</Text>
      <Text className={`text-[13px] font-semibold ${valueClassName}`}>{v}</Text>
    </View>
  );
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? 'Today' : d.toLocaleDateString();
}

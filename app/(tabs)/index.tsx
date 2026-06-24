/**
 * Assistant home — the "lazy" entry point and the day's conversation feed. The
 * user describes an expense ("12 bucks lunch at Joe's") or snaps a receipt; the
 * AI proxy parses it, the pure assistant logic decides whether to save / ask /
 * block, and confirmed entries join a feed of *today's* activity: the user's
 * words on the right, the resulting transaction record on the left. Manually
 * added entries (from the Transactions tab) also appear, as a compact record on
 * the right. The avatar is adaptive — it fills the screen when the feed is empty
 * and collapses to a header once the day has activity. The feed shows today only
 * and resets each day; the transactions themselves are never deleted.
 */
import React, { useCallback, useRef, useState } from 'react';
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
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AssistantAvatar } from '../../src/components/AssistantAvatar';
import { Bubble } from '../../src/components/ui/Bubble';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { FeedRecord } from '../../src/components/ui/FeedRecord';
import { icons } from '../../src/theme/assets';
import { parseExpense } from '../../src/features/ai/client';
import { saveAssistantDraft } from '../../src/features/ai/saveDraft';
import { listAccounts } from '../../src/features/accounts/repository';
import { listCategories } from '../../src/features/categories/repository';
import { listPayees } from '../../src/features/payees/repository';
import { listTransactions } from '../../src/features/transactions/repository';
import { interpret, TransactionDraft } from '../../src/domain/assistant';
import { findPayeeMatch } from '../../src/domain/payees';
import { unconfiguredRecognizer } from '../../src/features/ocr/recognizer';
import { getAccessToken } from '../../src/features/auth/repository';
import { formatMoney } from '../../src/domain/money';
import { formatDMY, isSameDay } from '../../src/domain/dates';
import { Account, Payee, Transaction } from '../../src/domain/types';
import { avatarStateFor, AssistantOutcomeKind } from '../../src/domain/avatar';

const GREETING = "Hi, I'm Xavier. Tell me about an expense, or snap a receipt.";
// Cap on how many recent payees we hint to the model (cost control).
const MAX_PAYEE_HINTS = 50;

/** One entry in today's feed: a saved transaction plus its resolved names. */
interface FeedItem {
  tx: Transaction;
  accountName?: string;
  categoryName?: string;
  payeeName?: string;
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(GREETING);
  const [pending, setPending] = useState<TransactionDraft | null>(null);
  // The utterance currently being parsed/confirmed (shown as a user bubble until
  // it's saved and becomes part of the transaction's stored sourceText).
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  // A close-but-not-exact existing payee to offer as "did you mean…?".
  const [suggestion, setSuggestion] = useState<Payee | null>(null);
  const [busy, setBusy] = useState(false);
  // Last transient outcome, for the avatar's reaction.
  const [lastOutcome, setLastOutcome] = useState<AssistantOutcomeKind>(null);
  const scrollRef = useRef<ScrollView>(null);

  const avatarState = avatarStateFor({
    busy,
    typing: draft.trim().length > 0,
    lastOutcome,
  });

  // Load today's activity for the feed (and keep accounts handy for the draft
  // card). Runs on focus so entries added on the Transactions tab show up too.
  const loadFeed = useCallback(async () => {
    const [txs, accts, categories, payees] = await Promise.all([
      listTransactions(),
      listAccounts(),
      listCategories(),
      listPayees(),
    ]);
    setAccounts(accts);
    const acctName = new Map(accts.map((a) => [a.id, a.name]));
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const payeeName = new Map(payees.map((p) => [p.id, p.name]));
    const now = Date.now();
    const items = txs
      .filter((t) => isSameDay(t.createdAt, now))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((tx) => ({
        tx,
        accountName: acctName.get(tx.accountId),
        categoryName: tx.categoryId ? catName.get(tx.categoryId) : undefined,
        payeeName: tx.payeeId ? payeeName.get(tx.payeeId) : undefined,
      }));
    setFeed(items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadFeed();
    }, [loadFeed])
  );

  async function runParse(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPending(null);
    setPendingText(text.trim());
    setSuggestion(null);
    setLastOutcome(null);
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
      const now = Date.now();
      const parsed = await parseExpense(
        {
          text: text.trim(),
          categories: categories.map((c) => c.name),
          payees: payees.slice(0, MAX_PAYEE_HINTS).map((p) => p.name),
          accounts: accts.filter((a) => !a.archived).map((a) => a.name),
          now,
        },
        token
      );
      const outcome = interpret(parsed, { accounts: accts, now });
      setReply(outcome.message);
      if (outcome.kind === 'confirm') {
        // Attach the user's words so they persist on save (feed user bubble).
        setPending({ ...outcome.draft, sourceText: text.trim() });
        // Local fuzzy reconcile (no extra AI call): if the parsed payee is close
        // to one the user already has, offer to merge instead of duplicating.
        if (outcome.draft.payeeName) {
          const { suggestion: near } = findPayeeMatch(
            outcome.draft.payeeName,
            payees
          );
          setSuggestion(near ?? null);
        }
      } else {
        // clarify / blocked → confused reaction
        setLastOutcome('clarify');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('parseExpense failed:', e);
      setReply(`Couldn't parse that — ${msg}`);
      setLastOutcome('error');
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
      setPendingText(null);
      setSuggestion(null);
      setReply('Saved! Anything else?');
      setLastOutcome('saved');
      await loadFeed();
      // Let the happy reaction play, then settle back to idle.
      setTimeout(() => setLastOutcome(null), 2500);
    } catch {
      setReply("I couldn't save that — please try again.");
      setLastOutcome('error');
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = () => {
    setPending(null);
    setPendingText(null);
    setSuggestion(null);
    setLastOutcome(null);
    setReply('No problem — discarded. What else?');
  };

  // "Use Starbucks" — adopt the existing payee's name so the save path matches
  // it exactly (and inherits its learned default category).
  const onUseSuggestion = () => {
    if (!suggestion) return;
    setPending((p) => (p ? { ...p, payeeName: suggestion.name } : p));
    setSuggestion(null);
  };

  // "Keep what I typed" — dismiss the hint; the new payee is created on save.
  const onKeepPayee = () => setSuggestion(null);

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

  // Adaptive: the avatar is the hero when there's nothing to show; once the day
  // has entries (or a draft is in flight) it collapses to a header so the feed
  // gets the room.
  const expanded = feed.length === 0 && !pending && !pendingText;

  const inputBar = (
    <>
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
          style={{ letterSpacing: 0 }}
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
    </>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 bg-bg px-5 pb-4" style={{ paddingTop: insets.top + 8 }}>
        {expanded ? (
          // Empty-state hero: big avatar fills the screen.
          <View className="flex-1">
            <View className="items-center mt-6">
              <AssistantAvatar size={172} state={avatarState} />
            </View>
            <Text className="text-text text-center text-base font-bold mt-6 px-4">
              {reply}
            </Text>
            <View className="flex-1" />
            {inputBar}
          </View>
        ) : (
          // Active: compact header + today's conversation feed.
          <View className="flex-1">
            <View className="flex-row items-center mb-2" style={{ gap: 10 }}>
              <AssistantAvatar size={34} state={avatarState} />
              <View>
                <Text className="text-text text-[13px] font-extrabold">Xavier</Text>
                <Text className="text-muted text-[10px]">Today · {formatDMY(Date.now())}</Text>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              className="flex-1"
              contentContainerStyle={{ gap: 9, paddingVertical: 8 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {feed.map((item) =>
                item.tx.source === 'ai' ? (
                  <View key={item.tx.id} style={{ gap: 9 }}>
                    {item.tx.sourceText ? (
                      <Bubble from="me">{item.tx.sourceText}</Bubble>
                    ) : null}
                    <FeedRecord
                      tx={item.tx}
                      accountName={item.accountName}
                      categoryName={item.categoryName}
                      payeeName={item.payeeName}
                      align="left"
                    />
                  </View>
                ) : (
                  <FeedRecord
                    key={item.tx.id}
                    tx={item.tx}
                    accountName={item.accountName}
                    categoryName={item.categoryName}
                    payeeName={item.payeeName}
                    align="right"
                    showManualTag
                  />
                )
              )}

              {/* In-flight exchange (not yet saved). */}
              {pendingText ? <Bubble from="me">{pendingText}</Bubble> : null}
              {!pending && reply !== GREETING ? <Bubble from="ai">{reply}</Bubble> : null}
              {pending && (
                <DraftCard
                  draft={pending}
                  accounts={accounts}
                  suggestion={suggestion}
                  onUseSuggestion={onUseSuggestion}
                  onKeepPayee={onKeepPayee}
                  onSave={onConfirm}
                  onDiscard={onDiscard}
                />
              )}
              {busy && <ActivityIndicator color="#5B8DEF" />}
            </ScrollView>

            {inputBar}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function DraftCard({
  draft,
  accounts,
  suggestion,
  onUseSuggestion,
  onKeepPayee,
  onSave,
  onDiscard,
}: {
  draft: TransactionDraft;
  accounts: Account[];
  suggestion: Payee | null;
  onUseSuggestion: () => void;
  onKeepPayee: () => void;
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
      {draft.unmatchedAccountName ? (
        <Text className="text-[11px] text-negative mb-1 -mt-1">
          "{draft.unmatchedAccountName}" not found — using {accountName}
        </Text>
      ) : null}
      <Field k="Payee" v={draft.payeeName ?? '—'} />
      <Field k="Category" v={draft.categoryName ?? '—'} />
      <Field k="Date" v={dateLabel(draft.occurredAt)} />

      {suggestion && draft.payeeName ? (
        <View className="mt-3 rounded-md border border-primary bg-surfaceAlt p-3">
          <Text className="text-text text-[13px]">
            Did you mean <Text className="font-bold">{suggestion.name}</Text>?
          </Text>
          <View className="flex-row mt-2.5" style={{ gap: 8 }}>
            <Button
              title={`Keep “${draft.payeeName}”`}
              variant="ghost"
              onPress={onKeepPayee}
              className="flex-1"
            />
            <Button
              title={`Use ${suggestion.name}`}
              variant="primary"
              onPress={onUseSuggestion}
              className="flex-1"
            />
          </View>
        </View>
      ) : null}

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
  return isSameDay(ms, Date.now()) ? 'Today' : formatDMY(ms);
}

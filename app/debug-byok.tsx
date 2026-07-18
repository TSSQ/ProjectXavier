/**
 * BYOK cloud-parse debug screen — test builds only (METRICS_ENABLED, same gate
 * as debug-fm.tsx). Reproduces the EXACT on-device BYOK parse path the
 * assistant screen (app/(tabs)/index.tsx runParse) takes, stage by stage, so a
 * "Test-key works but a real parse gives a confused face" report can be pinned
 * to the precise step that diverges — the router gating (isOnline/routeEngines),
 * the raw provider fetch (HTTP status + whether a usable tool_use/json object
 * came back), the normalize/guard/date/validate pipeline, or interpret()'s
 * confirm-vs-clarify decision.
 *
 * Reads the saved key from the Keychain itself (getByokKey) and NEVER displays
 * it — only the parsed expense fields (not secret) and non-secret status are
 * shown. Deep-link autorun for unattended probing:
 *   projectxavier://debug-byok?autorun=1[&text=lunch%2018%20at%20Sushiro]
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listCategories } from '../src/features/categories/repository';
import { listPayees } from '../src/features/payees/repository';
import { listAccounts } from '../src/features/accounts/repository';
import {
  getByokEnabled,
  getByokProvider,
  getByokModel,
  setByokEnabled,
  setByokProvider,
} from '../src/features/settings/repository';
import { getByokKey, hasByokKey } from '../src/features/ai/byokKey';
import { isOnline } from '../src/features/ai/network';
import { routeEngines, resolveByokEnabled } from '../src/domain/parseRouter';
import { fetchAnthropicRaw } from '../src/features/ai/engines/anthropic';
import { fetchOpenAiRaw } from '../src/features/ai/engines/openai';
import { anthropicParse } from '../src/features/ai/engines/anthropic';
import { openaiParse } from '../src/features/ai/engines/openai';
import { isRecord } from '../src/domain/cloudParseTransport';
import { CLOUD_REQUEST_TIMEOUT_MS } from '../src/features/ai/engines/shared';
import {
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  resolveRelativeDate,
  resolveAbsoluteDate,
  isUsefulDeviceParse,
} from '../src/domain/deviceParsePrompt';
import { aiParsedExpenseSchema } from '../src/lib/validation';
import { interpret } from '../src/domain/assistant';
import { isDeviceAiAvailable } from '../src/features/ai/deviceParse';
import { useThemeColors } from '../src/theme/useThemeColors';
import { METRICS_ENABLED } from '../src/lib/flags';

const DEFAULT_TEXT = 'lunch 18 at Sushiro';

interface Line {
  label: string;
  value: string;
  bad?: boolean;
}

export default function DebugByokScreen() {
  if (!METRICS_ENABLED) return <Redirect href="/" />;

  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ autorun?: string; text?: string; enable?: string }>();

  const initialText =
    typeof params.text === 'string' && params.text.trim().length
      ? params.text
      : DEFAULT_TEXT;
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  const run = useCallback(async (parseText: string) => {
    setBusy(true);
    const out: Line[] = [];
    const push = (label: string, value: string, bad = false) =>
      out.push({ label, value, bad });
    try {
      // Dev-only: ?enable=1 turns BYOK on + provider=anthropic in the real
      // settings store (idb can't flip the RN Switch), so the assistant screen
      // then exercises the true runParse cloud path end-to-end.
      if (params.enable === '1') {
        await setByokProvider('anthropic');
        await setByokEnabled(true);
        push('DEV: set byok_enabled=true, provider=anthropic', 'done');
      }
      // ── config / router gating (mirrors runParse's setup) ──────────────
      const [enabled, provider] = await Promise.all([
        getByokEnabled(),
        getByokProvider(),
      ]);
      // NB: check the Keychain directly — do NOT gate on `enabled` here (the
      // real runParse does, but this probe must exercise the live call even
      // when the sim toggle is off, since idb can't flip the RN Switch).
      const hasKey = await hasByokKey(provider);
      const deviceAiCapable = await isDeviceAiAvailable();
      // DIRECT, ungated call — this is the real question: does the captive.apple.com
      // HEAD probe report online while a real api.anthropic.com POST succeeds?
      const onlineDirect = await isOnline();
      push('isOnline() DIRECT', String(onlineDirect), !onlineDirect);
      const online = onlineDirect;
      const engineOrder = routeEngines({
        deviceAiCapable,
        byok: { enabled: resolveByokEnabled(enabled, hasKey), provider },
        online,
      });
      push('byok enabled (toggle)', String(enabled), !enabled);
      push('provider', String(provider));
      push('hasKey (Keychain)', String(hasKey), !hasKey);
      push('isDeviceAiAvailable()', String(deviceAiCapable));
      push('isOnline()', String(online), !online);
      push('engineOrder', engineOrder.join(' → '), engineOrder[0] !== provider);
      const model = await getByokModel(provider);
      push('model', model);

      if (!hasKey) {
        push('ABORT', 'no saved key — enter one in Settings → BYOK first', true);
        setLines(out);
        return;
      }

      // ── grounding data (same as runParse) ──────────────────────────────
      const [categories, payees, accounts] = await Promise.all([
        listCategories(),
        listPayees(),
        listAccounts(),
      ]);
      const now = Date.now();
      push(
        'grounding',
        `cats:${categories.length} payees:${payees.length} accounts:${accounts.length}`
      );
      const ctx = { categories, payees, accounts, now };
      const apiKey = (await getByokKey(provider))!;

      // ── raw provider fetch (the step Test-key also does) ───────────────
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
      let status = -1;
      let raw: unknown = null;
      try {
        const res =
          provider === 'openai'
            ? await fetchOpenAiRaw(parseText, ctx, apiKey, model, controller.signal)
            : await fetchAnthropicRaw(parseText, ctx, apiKey, model, controller.signal);
        status = res.status;
        raw = res.raw;
      } catch (e) {
        push('raw fetch THREW', e instanceof Error ? e.constructor.name : 'unknown', true);
      } finally {
        clearTimeout(timer);
      }
      push('http status', String(status), !(status >= 200 && status < 300));
      push('raw isRecord', String(isRecord(raw)), !isRecord(raw));
      push('raw object', raw == null ? 'null' : JSON.stringify(raw));

      // ── post-extraction pipeline (identical to shared.ts runCloudParse) ─
      if (isRecord(raw)) {
        const normalized = applyGroundingGuards(normalizeDeviceParseOutput(raw), parseText);
        push(
          'normalized.amount',
          normalized.amount == null ? 'null' : `${normalized.amount} minor`,
          normalized.amount == null
        );
        push('normalized.confidence', String(normalized.confidence), normalized.confidence < 0.5);
        push('normalized.type', String(normalized.type));
        push('normalized.category', String(normalized.category));
        push('normalized.payee', String(normalized.payee));
        const textDate =
          resolveRelativeDate(parseText, now) ?? resolveAbsoluteDate(parseText, now);
        if (textDate != null) normalized.occurredAt = textDate;
        const validated = aiParsedExpenseSchema.safeParse(normalized);
        push('schema valid', String(validated.success), !validated.success);
        if (!validated.success) {
          push('schema error', validated.error.issues.map((i) => i.path.join('.') + ':' + i.message).join('; '), true);
        } else {
          push('isUsefulDeviceParse', String(isUsefulDeviceParse(validated.data)), !isUsefulDeviceParse(validated.data));
          const outcome = interpret(validated.data, { accounts, now, text: parseText });
          push('interpret.kind', outcome.kind, outcome.kind !== 'confirm');
          if (outcome.kind === 'clarify') {
            push('clarify.missing', outcome.missing.join(',') || '(low confidence)', true);
          }
        }
      }

      // ── full engine (what runParse actually calls) ─────────────────────
      const parseFn = provider === 'openai' ? openaiParse : anthropicParse;
      const parsed = await parseFn(parseText, ctx, apiKey, model);
      push(
        'anthropicParse() final',
        parsed == null ? 'null (→ falls through to FM/heuristic)' : `amount ${parsed.amount}, conf ${parsed.confidence}`,
        parsed == null
      );
      if (parsed) {
        push('final useful', String(isUsefulDeviceParse(parsed)), !isUsefulDeviceParse(parsed));
        const outcome = interpret(parsed, { accounts, now, text: parseText });
        push('final interpret.kind', outcome.kind, outcome.kind !== 'confirm');
      }
    } catch (e) {
      push('SCREEN THREW', e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e), true);
    } finally {
      setLines(out);
      setBusy(false);
    }
  }, []);

  const autoran = useRef(false);
  useEffect(() => {
    if (params.autorun === '1' && !autoran.current) {
      autoran.current = true;
      run(initialText);
    }
  }, [params.autorun, initialText, run]);

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back" className="flex-row items-center mb-4">
          <Feather name="chevron-left" size={24} color={c.muted} />
          <Text className="text-muted text-base ml-1">Back</Text>
        </Pressable>

        <Text className="text-text text-[24px] font-extrabold mb-1">BYOK cloud parse</Text>
        <Text className="text-muted text-xs mb-4">
          Test-build diagnostics · reproduces the real BYOK parse path stage by stage.
        </Text>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={DEFAULT_TEXT}
          placeholderTextColor={c.muted}
          className="bg-surfaceAlt border border-border rounded-md px-3 py-2 text-text text-[13px] mb-3"
          multiline
        />
        <Pressable
          onPress={() => run(text)}
          disabled={busy}
          className="bg-primary rounded-md px-4 py-3 items-center mb-4"
          style={{ opacity: busy ? 0.6 : 1 }}
          accessibilityLabel="Run BYOK parse"
        >
          <Text className="text-white text-[14px] font-bold">{busy ? 'Running…' : 'Run BYOK parse'}</Text>
        </Pressable>

        {lines.length === 0 ? (
          <Text className="text-muted">No run yet.</Text>
        ) : (
          lines.map((l, i) => (
            <View key={i} className="flex-row justify-between py-1 border-b border-border">
              <Text className="text-muted text-[12px] flex-1 pr-3">{l.label}</Text>
              <Text
                className={`text-[12px] font-semibold flex-1 text-right ${l.bad ? 'text-negative' : 'text-text'}`}
              >
                {l.value}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

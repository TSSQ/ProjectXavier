/**
 * Root layout. Initialises the database and gates behind a biometric unlock —
 * no financial data renders until the device is unlocked.
 */
import '../src/lib/aiPolyfills';
import '../global.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colorScheme, useColorScheme } from 'nativewind';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PortalProvider } from '@gorhom/portal';
import { initDb, isDbReady } from '../src/db/client';
import { migrate } from '../src/db/migrate';
import { postDueOccurrences, listSeries } from '../src/features/recurring/repository';
import { listTransactions } from '../src/features/transactions/repository';
import { updateWidgetSummary } from '../src/features/widget/summary';
import { requireBiometricUnlock } from '../src/lib/secureStore';
import {
  getTheme,
  getBiometricLock,
  getBiometricLockCached,
  getSetting,
  setSetting,
} from '../src/features/settings/repository';
import { findSelfTransfers, findSelfTransferSeries } from '../src/domain/balances';
import { formatMoney } from '../src/domain/money';
import { formatDMY } from '../src/domain/dates';
import { useThemeColors } from '../src/theme/useThemeColors';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { Button } from '../src/components/ui/Button';

/** Settings key gating the one-time self-transfer scan alert (review F2) —
 *  once acknowledged, the alert never re-shows even if the bad rows are
 *  still unrepaired. */
const SELF_TRANSFER_SCAN_ACK_KEY = 'selftransfer_scan_ack';

/**
 * One-time data-integrity scan (review F2): copying an incoming transfer
 * used to forge a same-account transfer that silently drained the balance.
 * `signedDelta`/the schema now prevent new ones, but any that predate the
 * fix are still sitting in the DB — surface them once so the user knows to
 * repair/delete via Transactions search. Non-fatal: swallows its own errors
 * so a scan failure never blocks startup.
 *
 * MUST only be invoked once the app is unlocked (see the `unlocked`-keyed
 * effect in RootLayout below) — never from the pre-auth startup effect.
 * `Alert.alert` is a native modal that presents independently of the React
 * tree, so firing this before the biometric gate resolves could pop the
 * alert (real transaction dates/amounts) over the "Locked" splash, violating
 * guardrail #2 (authentication required before financial data renders).
 */
async function scanForSelfTransfers(): Promise<void> {
  try {
    if (await getSetting(SELF_TRANSFER_SCAN_ACK_KEY)) return;

    const [transactions, series] = await Promise.all([
      listTransactions(),
      listSeries(),
    ]);
    const badTx = findSelfTransfers(transactions);
    const badSeries = findSelfTransferSeries(series);
    if (badTx.length === 0 && badSeries.length === 0) return;

    const lines = [
      ...badTx.map(
        (tx) => `• ${formatDMY(tx.occurredAt)} · ${formatMoney(tx.amount, tx.currency)}`
      ),
      ...badSeries.map(
        (s) => `• Recurring series · ${formatMoney(s.template.amount, s.template.currency)}`
      ),
    ];

    Alert.alert(
      'Self-transfer found',
      `${lines.length === 1 ? 'A transaction' : `${lines.length} transactions`} moved money ` +
        `between the same account, which silently reduced its balance:\n\n${lines.join('\n')}` +
        `\n\nEdit or delete ${lines.length === 1 ? 'it' : 'them'} from Transactions search.`,
      [
        {
          text: 'OK',
          onPress: () => { void setSetting(SELF_TRANSFER_SCAN_ACK_KEY, '1'); },
        },
      ]
    );
  } catch (e) {
    console.error('Self-transfer scan failed:', e);
  }
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Refs mirror the latest state/setting for use inside the AppState listener,
  // which is registered once — reading React state there would close over
  // stale values. `bioLockRef` is refreshed on every `active` transition (and
  // at startup) rather than read async at background-time, because the
  // background handler must call setUnlocked(false) synchronously, before the
  // app-switcher snapshot is taken; awaiting a setting read would be too late.
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  // Initialised to the setting's own default (opt-in, off) rather than a
  // hardcoded "locked" guess: if a background/foreground cycle races the
  // startup read (below) before it resolves, this is what a fresh install
  // falls back to — it must not force a Face ID prompt nobody opted into.
  const bioLockRef = useRef(false);
  // Guards against overlapping biometric prompts (e.g. a cold-start prompt
  // still in flight when a fast background→active cycle fires resume again).
  const promptInFlightRef = useRef(false);
  // iOS reaches 'background' via an intermediate 'inactive' hop (active →
  // inactive → background, and back the same way on resume), so `prev` at
  // the moment `nextState` finally settles on 'active'/'background' is
  // usually 'inactive', not 'active'/'background' themselves. This ref tracks
  // whether the app actually reached 'background' (as opposed to merely
  // passing through 'inactive' for the Face ID sheet, a permission dialog, or
  // Control Center) so resume only re-prompts after a real backgrounding.
  const enteredBackgroundRef = useRef(false);
  // Guards the self-transfer scan to a single run per app session: `unlocked`
  // can legitimately flip false→true more than once (e.g. background-lock
  // then re-authenticate), but the scan (and its Alert) must fire at most
  // once per launch — cross-launch dedup is the separate
  // `selftransfer_scan_ack` settings gate inside scanForSelfTransfers itself.
  const selfTransferScanRanRef = useRef(false);

  const runUnlockPrompt = useCallback(async () => {
    if (promptInFlightRef.current) return;
    promptInFlightRef.current = true;
    try {
      const success = await requireBiometricUnlock();
      setUnlocked(success);
    } finally {
      promptInFlightRef.current = false;
    }
  }, []);

  // Opportunistic auto-backup + biometric re-lock when the app moves to/from
  // the background. A single listener drives both so there's exactly one
  // AppState subscription.
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

          // Refresh the widget summary too. Statically imported already
          // (used at startup below), so no lazy import needed here;
          // updateWidgetSummary() never throws on its own, but void + no
          // .catch would still surface an unhandled rejection if it somehow
          // did, so guard it the same way as the backup call above.
          void updateWidgetSummary().catch(() => {/* swallow */});
        }

        // Re-lock strictly once the app reaches 'background' (not merely
        // 'inactive', which also covers the Face ID sheet itself, permission
        // dialogs, and Control Center — those return to 'active' without ever
        // reaching 'background', so treating 'inactive' as a lock trigger
        // would immediately re-prompt and loop). Locking here also means the
        // splash — not live data — is what shows in the app switcher
        // snapshot. Must be synchronous (no await) so it lands before the OS
        // takes the snapshot; that's why the toggle is read from a ref
        // rather than fetched here.
        if (nextState === 'background') {
          enteredBackgroundRef.current = true;
          // The repository's synchronous cache wins over the ref: it reflects
          // a Settings toggle flipped moments ago, where the ref only catches
          // up on the next 'active' transition.
          if (getBiometricLockCached() ?? bioLockRef.current) setUnlocked(false);
        }

        if (nextState === 'active') {
          // Keep the cached toggle fresh for the next backgrounding. Fire-
          // and-forget: a toggle flipped and immediately backgrounded before
          // this resolves is a known, accepted stale-by-one edge case.
          // Guarded on isDbReady() rather than letting this hit the db
          // proxy's thrown-before-initDb() diagnostic: on a slow cold
          // launch this listener can fire (e.g. a fast inactive->active
          // hop for a system dialog) before the startup effect's
          // `await initDb()` below has resolved — bioLockRef.current
          // (already initialised to `false`, the setting's own default) is
          // intentionally left as the cached value in that case, refreshed
          // on the next transition.
          if (isDbReady()) {
            getBiometricLock()
              .then((v) => { bioLockRef.current = v; })
              .catch(() => {/* keep previous cached value */});
          }

          // Resume from a real backgrounding re-prompts if still locked.
          if (enteredBackgroundRef.current) {
            enteredBackgroundRef.current = false;
            if (!unlockedRef.current) runUnlockPrompt();
          }
        }
      },
    );
    return () => subscription.remove();
  }, [runUnlockPrompt]);

  useEffect(() => {
    (async () => {
      try {
        // Opens the (SQLCipher-keyed) DB and migrates a legacy plaintext DB
        // in place if one is found — must resolve before any query,
        // including the schema migration below. See src/db/client.ts.
        await initDb();
        await migrate();
        // Post any missed recurring occurrences in background; non-fatal.
        // Chained (not parallel) so the widget summary — refreshed right
        // after, also non-blocking for the splash gate — picks up anything
        // just auto-posted. Also covers the very first app open, when no
        // widget-summary.json exists yet (updateWidgetSummary() is cheap and
        // swallows its own errors).
        postDueOccurrences(Date.now())
          .catch((e) => console.error('Recurring post failed:', e))
          .finally(() => { void updateWidgetSummary(); });
        // Resolve the Appearance preference alongside the other startup loads
        // (behind the same splash gate) and apply it before the app renders,
        // so there's no dark→light flash after the splash clears.
        colorScheme.set(await getTheme());
        setReady(true);
        // The user-persisted toggle (Settings → Require Face ID on launch)
        // decides whether the biometric prompt gates the app; it's opt-in
        // (default OFF) so a fresh install never prompts before the user has
        // chosen to turn it on.
        const bioLock = await getBiometricLock();
        bioLockRef.current = bioLock;
        if (bioLock) {
          // Routed through runUnlockPrompt so its in-flight guard also
          // covers a fast background/resume racing the cold-start prompt.
          await runUnlockPrompt();
        } else {
          setUnlocked(true);
        }
      } catch (e) {
        // Never leave the user stuck on the splash — surface what failed.
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Startup failed:', e);
        setStartupError(msg);
      }
    })();
  }, [runUnlockPrompt]);

  // Guardrail #2 (authentication required before financial data renders):
  // the self-transfer scan's Alert quotes real transaction dates/amounts, so
  // it must never fire until the app is actually unlocked — whether that's
  // because bio-lock is OFF (setUnlocked(true) fires immediately above) or
  // because the biometric prompt just succeeded. Keyed on `unlocked` (not
  // run inline in the startup effect) so it can't race/precede the gate;
  // `selfTransferScanRanRef` caps it at once per session even though
  // `unlocked` can flip true more than once (re-auth after backgrounding).
  useEffect(() => {
    if (!unlocked || selfTransferScanRanRef.current) return;
    selfTransferScanRanRef.current = true;
    void scanForSelfTransfers();
  }, [unlocked]);

  if (startupError) {
    return <Splash message={`Startup failed: ${startupError}`} />;
  }

  if (!ready || !unlocked) {
    return (
      <Splash
        message={ready ? 'Locked — authenticate to continue' : 'Preparing…'}
        onUnlock={ready ? runUnlockPrompt : undefined}
      />
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

function Splash({
  message,
  onUnlock,
}: {
  message: string;
  /** Retries the biometric prompt. Omitted while the app is still starting. */
  onUnlock?: () => void;
}) {
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
      {onUnlock && (
        <Button
          title="Unlock"
          onPress={onUnlock}
          accessibilityLabel="Unlock"
          className="mt-5 px-6"
        />
      )}
    </View>
  );
}

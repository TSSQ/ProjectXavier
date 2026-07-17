/**
 * Best-effort "is the device online right now" probe — used only to decide
 * whether src/domain/parseRouter.ts's `routeEngines` should even attempt the
 * BYOK cloud provider for this parse, so a device that's clearly offline
 * skips straight to Foundation Models/heuristic instead of waiting out a
 * multi-second request timeout first.
 *
 * Deliberately dependency-free (no NetInfo/native module — nothing new to
 * link or prebuild): a tiny HEAD request with a short timeout against
 * Apple's own captive-portal probe host, the same one iOS itself already
 * pings on every network join. No app data leaves the device; nothing here
 * is logged.
 *
 * NOT a hard gate: even if this probe is wrong (says "online" while the
 * network is actually down, or vice versa), the cloud engines
 * (src/features/ai/engines/openai.ts / anthropic.ts) have their own request
 * timeout and return `null` on any failure — so a wrong guess here only
 * costs a little latency, it never breaks the fallback chain to
 * Foundation Models / the heuristic.
 */
const PROBE_URL = 'https://captive.apple.com/hotspot-detect.html';
const PROBE_TIMEOUT_MS = 2_500;

export async function isOnline(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(PROBE_URL, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

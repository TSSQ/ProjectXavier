import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  stubToLogicalName,
  mergeFallbackListing,
  rowState,
  isRestorable,
  shouldKeepWaiting,
  CloudEntrySchema,
  CloudEntryStatus,
  CloudNamesSchema,
  CloudStatusSchemaError,
  listWithFallback,
  parseCloudEntryOrThrow,
} from '../../src/domain/backupSync';

const feature = loadFeature(path.resolve(__dirname, '../__features__/backup-sync.feature'));

/** Fills in a full CloudEntryStatus from just the flags a scenario cares
 *  about — default is "settled, on device, no errors, nothing in flight". */
function makeStatus(overrides: Partial<CloudEntryStatus>): CloudEntryStatus {
  return {
    downloadStatus: 'current',
    isDownloading: false,
    percentDownloaded: null,
    isUploaded: true,
    isUploading: false,
    percentUploaded: null,
    downloadingError: null,
    uploadingError: null,
    ...overrides,
  };
}

// A fixed epoch anchor so "Nms ago" reads naturally regardless of wall-clock
// time — shouldKeepWaiting only ever looks at differences between its args.
const NOW = 1_000_000_000;

/**
 * Stands in for icloud.ts's module-absent `ensureDownloaded` fallback
 * (`triggerSync` then poll `exists` — no progress signal exists on this
 * path) — composed from the REAL `shouldKeepWaiting` under test, so a
 * mutation to that function breaks this smoke test too. Spec §6.7 / §9: the
 * simulator can't drive a real iCloud account, so the fallback path is
 * proven here with a double instead of on device (see memory
 * `headless-simulator-driving`).
 *
 * `lastProgressAt` is `null`, matching the real fallback path in icloud.ts
 * (QA round 1 Major): an earlier version of this double passed `startedAt`
 * instead, which made `now - lastProgressAt` equal elapsed time on every
 * tick and reported "stalled" for a file that simply hadn't appeared within
 * 30s yet — the double was reproducing the bug it should have caught. With
 * `null`, only the `maxMs` budget applies, matching production.
 */
async function runFallbackDownloadDouble(
  exists: () => Promise<boolean>,
  nextNow: () => number,
): Promise<'downloaded' | 'stalled' | 'timedOut'> {
  const startedAt = nextNow();
  for (;;) {
    if (await exists()) return 'downloaded';
    const now = nextNow();
    const decision = shouldKeepWaiting(now - startedAt, null, now);
    if (decision !== 'wait') return decision;
  }
}

defineFeature(feature, (test) => {
  // ─── stubToLogicalName ──────────────────────────────────────────────────

  test('stubToLogicalName recovers the logical name from a not-yet-downloaded stub', ({
    given,
    when,
    then,
  }) => {
    let raw: string;
    let logical: string | null;

    given(/^the raw directory entry "(.*)"$/, (name: string) => {
      raw = name;
    });

    when(/^I map it to a logical name$/, () => {
      logical = stubToLogicalName(raw);
    });

    then(/^the logical name should be "(.*)"$/, (expected: string) => {
      expect(logical).toBe(expected);
    });
  });

  test('stubToLogicalName returns null for a name that is not a stub', ({ given, when, then }) => {
    let raw: string;
    let logical: string | null;

    given(/^the raw directory entry "(.*)"$/, (name: string) => {
      raw = name;
    });

    when(/^I map it to a logical name$/, () => {
      logical = stubToLogicalName(raw);
    });

    then(/^the logical name should be null$/, () => {
      expect(logical).toBeNull();
    });
  });

  test('stubToLogicalName recovers the logical name even for a stub of a non-backup file', ({
    given,
    when,
    then,
  }) => {
    let raw: string;
    let logical: string | null;

    given(/^the raw directory entry "(.*)"$/, (name: string) => {
      raw = name;
    });

    when(/^I map it to a logical name$/, () => {
      logical = stubToLogicalName(raw);
    });

    then(/^the logical name should be "(.*)"$/, (expected: string) => {
      expect(logical).toBe(expected);
    });
  });

  // ─── mergeFallbackListing ────────────────────────────────────────────────

  test('mergeFallbackListing mixes downloaded files and not-yet-downloaded stubs', ({
    given,
    when,
    then,
  }) => {
    let rawNames: string[];
    let merged: { name: string; downloaded: boolean }[];

    given(/^a raw readdir listing of:$/, (table: { name: string }[]) => {
      rawNames = table.map((r) => r.name);
    });

    when(/^I merge the fallback listing$/, () => {
      merged = mergeFallbackListing(rawNames);
    });

    then(/^it should report:$/, (table: { name: string; downloaded: string }[]) => {
      expect(merged).toEqual(
        table.map((r) => ({ name: r.name, downloaded: r.downloaded === 'true' })),
      );
    });
  });

  test('mergeFallbackListing dedupes a logical name reported as both a stub and a real file', ({
    given,
    when,
    then,
  }) => {
    let rawNames: string[];
    let merged: { name: string; downloaded: boolean }[];

    given(/^a raw readdir listing of:$/, (table: { name: string }[]) => {
      rawNames = table.map((r) => r.name);
    });

    when(/^I merge the fallback listing$/, () => {
      merged = mergeFallbackListing(rawNames);
    });

    then(/^it should report:$/, (table: { name: string; downloaded: string }[]) => {
      expect(merged).toEqual(
        table.map((r) => ({ name: r.name, downloaded: r.downloaded === 'true' })),
      );
    });
  });

  // ─── rowState precedence ─────────────────────────────────────────────────

  test('rowState — a download error beats every other in-flight flag', ({
    given,
    when,
    then,
  }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(/^a status that is downloading, uploading, and has a download error$/, () => {
      status = makeStatus({
        isDownloading: true,
        isUploading: true,
        downloadingError: 'Network error',
      });
    });

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('rowState — an upload error beats downloading, uploading, and inCloud', ({
    given,
    when,
    then,
  }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(
      /^a status that is downloading and uploading with an upload error but no download error$/,
      () => {
        status = makeStatus({
          isDownloading: true,
          isUploading: true,
          uploadingError: 'Network error',
        });
      },
    );

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('rowState — downloading beats uploading and inCloud', ({ given, when, then }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(/^a status that is downloading and uploading with no errors$/, () => {
      status = makeStatus({ isDownloading: true, isUploading: true });
    });

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('rowState — uploading beats inCloud', ({ given, when, then }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(/^a status that is uploading and not downloaded, with no errors$/, () => {
      status = makeStatus({ downloadStatus: 'notDownloaded', isUploading: true });
    });

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('rowState — a not-yet-downloaded file with nothing in flight is inCloud', ({
    given,
    when,
    then,
  }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(/^a status that is notDownloaded with nothing in flight and no errors$/, () => {
      status = makeStatus({ downloadStatus: 'notDownloaded' });
    });

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('rowState — a current file with nothing in flight is onDevice', ({
    given,
    when,
    then,
  }) => {
    let status: CloudEntryStatus;
    let result: string;

    given(/^a status that is current with nothing in flight and no errors$/, () => {
      status = makeStatus({ downloadStatus: 'current' });
    });

    when(/^I merge it into a row state$/, () => {
      result = rowState(status);
    });

    then(/^the row state should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  // ─── isRestorable ─────────────────────────────────────────────────────────

  test('isRestorable is true for a current, non-transferring file', ({ given, when, then }) => {
    let status: CloudEntryStatus;
    let restorable: boolean;

    given(/^a status that is current with nothing in flight and no errors$/, () => {
      status = makeStatus({ downloadStatus: 'current' });
    });

    when(/^I check whether it is restorable$/, () => {
      restorable = isRestorable(status);
    });

    then(/^it should be restorable$/, () => {
      expect(restorable).toBe(true);
    });
  });

  test('isRestorable is false while still downloading, even if marked current', ({
    given,
    when,
    then,
  }) => {
    let status: CloudEntryStatus;
    let restorable: boolean;

    given(/^a status that is current but still downloading$/, () => {
      status = makeStatus({ downloadStatus: 'current', isDownloading: true });
    });

    when(/^I check whether it is restorable$/, () => {
      restorable = isRestorable(status);
    });

    then(/^it should not be restorable$/, () => {
      expect(restorable).toBe(false);
    });
  });

  test('isRestorable is false for a not-yet-downloaded file', ({ given, when, then }) => {
    let status: CloudEntryStatus;
    let restorable: boolean;

    given(/^a status that is notDownloaded with nothing in flight and no errors$/, () => {
      status = makeStatus({ downloadStatus: 'notDownloaded' });
    });

    when(/^I check whether it is restorable$/, () => {
      restorable = isRestorable(status);
    });

    then(/^it should not be restorable$/, () => {
      expect(restorable).toBe(false);
    });
  });

  // ─── shouldKeepWaiting ─────────────────────────────────────────────────────

  test('shouldKeepWaiting says wait when within both budgets with recent progress', ({
    given,
    when,
    then,
  }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting stalls after 30 seconds without progress', ({ given, when, then }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting times out after 120 seconds total, even with recent progress', ({
    given,
    when,
    then,
  }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting prefers timedOut over stalled when both budgets are blown at once', ({
    given,
    when,
    then,
  }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting — progress resets the stall clock', ({ given, when, then }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting stalls at exactly the 30-second boundary', ({ given, when, then }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting times out at exactly the 120-second boundary', ({ given, when, then }) => {
    let elapsedMs: number;
    let lastProgressAt: number;
    let decision: string;

    given(
      /^a download (\d+)ms in with progress observed (\d+)ms ago$/,
      (elapsed: string, sinceProgress: string) => {
        elapsedMs = Number(elapsed);
        lastProgressAt = NOW - Number(sinceProgress);
      },
    );

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, lastProgressAt, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting never stalls when there is no progress signal at all', ({
    given,
    when,
    then,
  }) => {
    let elapsedMs: number;
    let decision: string;

    given(/^a download (\d+)ms in with no progress signal$/, (elapsed: string) => {
      elapsedMs = Number(elapsed);
    });

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, null, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  test('shouldKeepWaiting still times out at 120 seconds with no progress signal at all', ({
    given,
    when,
    then,
  }) => {
    let elapsedMs: number;
    let decision: string;

    given(/^a download (\d+)ms in with no progress signal$/, (elapsed: string) => {
      elapsedMs = Number(elapsed);
    });

    when(/^I ask whether to keep waiting$/, () => {
      decision = shouldKeepWaiting(elapsedMs, null, NOW);
    });

    then(/^the decision should be "(.*)"$/, (expected: string) => {
      expect(decision).toBe(expected);
    });
  });

  // ─── CloudEntrySchema (native payload trust boundary) ────────────────────

  function wellFormedPayload(): Record<string, unknown> {
    return {
      name: 'projectxavier-backup-1700000000000-iPhone.sqlite',
      size: 1234,
      downloadStatus: 'current',
      isDownloading: false,
      percentDownloaded: null,
      isUploaded: true,
      isUploading: false,
      percentUploaded: null,
    };
  }

  test('CloudEntrySchema accepts a well-formed native payload item', ({ given, when, then }) => {
    let payload: Record<string, unknown>;
    let result: { success: boolean };

    given(/^a well-formed native cloud entry payload$/, () => {
      payload = wellFormedPayload();
    });

    when(/^I validate it against CloudEntrySchema$/, () => {
      result = CloudEntrySchema.safeParse(payload);
    });

    then(/^validation should succeed$/, () => {
      expect(result.success).toBe(true);
    });
  });

  test('CloudEntrySchema accepts a payload with no size (the status() shape)', ({
    given,
    when,
    then,
  }) => {
    let payload: Record<string, unknown>;
    let result: { success: boolean };

    given(/^a native cloud entry payload with no size field$/, () => {
      const { size, ...rest } = wellFormedPayload();
      void size;
      payload = rest;
    });

    when(/^I validate it against CloudEntrySchema$/, () => {
      result = CloudEntrySchema.safeParse(payload);
    });

    then(/^validation should succeed$/, () => {
      expect(result.success).toBe(true);
    });
  });

  test('CloudEntrySchema accepts a payload with percentDownloaded/percentUploaded omitted entirely', ({
    given,
    when,
    then,
  }) => {
    let payload: Record<string, unknown>;
    let result: { success: boolean };

    given(/^a native cloud entry payload with the percent fields omitted, not null$/, () => {
      const { percentDownloaded, percentUploaded, ...rest } = wellFormedPayload();
      void percentDownloaded;
      void percentUploaded;
      payload = rest;
    });

    when(/^I validate it against CloudEntrySchema$/, () => {
      result = CloudEntrySchema.safeParse(payload);
    });

    then(/^validation should succeed$/, () => {
      expect(result.success).toBe(true);
    });
  });

  test('CloudEntrySchema rejects a malformed payload without throwing', ({
    given,
    when,
    then,
  }) => {
    let payload: Record<string, unknown>;
    let result: { success: boolean };

    given(/^a malformed native cloud entry payload with a non-boolean isDownloading$/, () => {
      payload = { ...wellFormedPayload(), isDownloading: 'yes' };
    });

    when(/^I validate it against CloudEntrySchema$/, () => {
      // safeParse never throws by construction — this proves the "without
      // throwing" half of the requirement as much as a synchronous call can;
      // the "at the caller" half is proven by icloud.ts's own use of
      // safeParse (never `.parse`) at every native-payload boundary.
      expect(() => {
        result = CloudEntrySchema.safeParse(payload);
      }).not.toThrow();
    });

    then(/^validation should fail without throwing$/, () => {
      expect(result.success).toBe(false);
    });
  });

  // ─── parseCloudEntryOrThrow (QA round 3 M1) ────────────────────────────

  test('parseCloudEntryOrThrow returns the parsed entry for a well-formed payload', ({
    given,
    when,
    then,
  }) => {
    let payload: Record<string, unknown>;
    let result: ReturnType<typeof parseCloudEntryOrThrow> | undefined;
    let thrown: unknown;

    given(/^a well-formed native cloud entry payload$/, () => {
      payload = wellFormedPayload();
    });

    when(/^I parse it with parseCloudEntryOrThrow$/, () => {
      thrown = undefined;
      try {
        result = parseCloudEntryOrThrow(payload, 'irrelevant-name');
      } catch (e) {
        thrown = e;
      }
    });

    then(/^it should return the parsed entry, not throw$/, () => {
      expect(thrown).toBeUndefined();
      expect(result?.name).toBe(payload.name);
    });
  });

  test('parseCloudEntryOrThrow throws a distinct schema error for a malformed payload, not a status that reads as legitimate', ({
    given,
    when,
    then,
  }) => {
    let payload: Record<string, unknown>;
    let result: ReturnType<typeof parseCloudEntryOrThrow> | undefined;
    let thrown: unknown;

    given(/^a malformed native cloud entry payload with a non-boolean isDownloading$/, () => {
      payload = { ...wellFormedPayload(), isDownloading: 'yes' };
    });

    when(/^I parse it with parseCloudEntryOrThrow$/, () => {
      result = undefined;
      thrown = undefined;
      try {
        result = parseCloudEntryOrThrow(payload, 'irrelevant-name');
      } catch (e) {
        thrown = e;
      }
    });

    then(/^it should throw a CloudStatusSchemaError, not return a value$/, () => {
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(CloudStatusSchemaError);
      expect((thrown as Error).message).toMatch(/ERR_ICLOUD_STATUS_SCHEMA/);
    });
  });

  // ─── CloudNamesSchema (QA round 3 minor 5) ─────────────────────────────

  test('CloudNamesSchema accepts a well-formed array of names', ({ given, when, then }) => {
    let raw: unknown;
    let result: { success: boolean };

    given(/^a raw readdir result of well-formed names$/, () => {
      raw = ['projectxavier-backup-1700000000000.sqlite', '.projectxavier-backup-1600000000000.sqlite.icloud'];
    });

    when(/^I validate it against CloudNamesSchema$/, () => {
      result = CloudNamesSchema.safeParse(raw);
    });

    then(/^validation should succeed$/, () => {
      expect(result.success).toBe(true);
    });
  });

  test('CloudNamesSchema rejects a malformed readdir result without throwing', ({
    given,
    when,
    then,
  }) => {
    let raw: unknown;
    let result: { success: boolean };

    given(/^a raw readdir result that is not an array of strings$/, () => {
      raw = [{ name: 'not-a-string-entry' }];
    });

    when(/^I validate it against CloudNamesSchema$/, () => {
      expect(() => {
        result = CloudNamesSchema.safeParse(raw);
      }).not.toThrow();
    });

    then(/^validation should fail without throwing$/, () => {
      expect(result.success).toBe(false);
    });
  });

  // ─── listWithFallback (QA round 3 B1) ──────────────────────────────────

  test('listWithFallback returns the module listing\'s result without calling the fallback', ({
    given,
    and,
    when,
    then,
  }) => {
    let fallbackCalled = false;
    let moduleListing: () => Promise<string>;
    let fallbackListing: () => Promise<string>;
    let result: string;

    given(/^a module listing that succeeds with "(.*)"$/, (value: string) => {
      fallbackCalled = false;
      moduleListing = async () => value;
    });

    and(/^a fallback listing that would return "(.*)"$/, (value: string) => {
      fallbackListing = async () => {
        fallbackCalled = true;
        return value;
      };
    });

    when(/^I run listWithFallback$/, async () => {
      result = await listWithFallback(moduleListing, fallbackListing);
    });

    then(/^the result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });

    and(/^the fallback listing should never have been called$/, () => {
      expect(fallbackCalled).toBe(false);
    });
  });

  test('listWithFallback falls through to the fallback listing when the module listing throws', ({
    given,
    and,
    when,
    then,
  }) => {
    let moduleListing: () => Promise<string>;
    let fallbackListing: () => Promise<string>;
    let result: string;

    given(/^a module listing that throws ERR_ICLOUD_GATHER_TIMEOUT$/, () => {
      moduleListing = async () => {
        throw new Error('ERR_ICLOUD_GATHER_TIMEOUT');
      };
    });

    and(/^a fallback listing that would return "(.*)"$/, (value: string) => {
      fallbackListing = async () => value;
    });

    when(/^I run listWithFallback$/, async () => {
      result = await listWithFallback(moduleListing, fallbackListing);
    });

    then(/^the result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test("listWithFallback propagates the fallback listing's own failure when both branches throw", ({
    given,
    and,
    when,
    then,
  }) => {
    let moduleListing: () => Promise<string>;
    let fallbackListing: () => Promise<string>;
    let rejected: unknown;

    given(/^a module listing that throws ERR_ICLOUD_GATHER_TIMEOUT$/, () => {
      moduleListing = async () => {
        throw new Error('ERR_ICLOUD_GATHER_TIMEOUT');
      };
    });

    and(/^a fallback listing that also throws$/, () => {
      fallbackListing = async () => {
        throw new Error('ERR_FALLBACK_READDIR_FAILED');
      };
    });

    when(/^I run listWithFallback and it rejects$/, async () => {
      rejected = undefined;
      try {
        await listWithFallback(moduleListing, fallbackListing);
      } catch (e) {
        rejected = e;
      }
    });

    then(/^listWithFallback should reject with the fallback listing's own error$/, () => {
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).message).toBe('ERR_FALLBACK_READDIR_FAILED');
    });
  });

  // ─── Fallback adapter double (spec §6.7 / §9) ─────────────────────────────

  test('Fallback ensureDownloaded double resolves once the file appears locally', ({
    given,
    when,
    then,
  }) => {
    let outcome: string;
    let exists: () => Promise<boolean>;
    let nextNow: () => number;

    given(/^a fallback download double where the file appears on the 3rd check$/, () => {
      let checks = 0;
      exists = async () => {
        checks += 1;
        return checks >= 3;
      };
      let t = 0;
      nextNow = () => {
        t += 1000;
        return t;
      };
    });

    when(/^I run the fallback download double$/, async () => {
      outcome = await runFallbackDownloadDouble(exists, nextNow);
    });

    then(/^the fallback outcome should be "(.*)"$/, (expected: string) => {
      expect(outcome).toBe(expected);
    });
  });

  test('Fallback ensureDownloaded double resolves when the file appears slowly, past the old 30s stall threshold', ({
    given,
    when,
    then,
  }) => {
    let outcome: string;
    let exists: () => Promise<boolean>;
    let nextNow: () => number;

    given(/^a fallback download double where the file appears after 40 seconds$/, () => {
      // 5th check, at 10s/tick, lands at ~40s elapsed — past the OLD
      // (buggy) 30s stall threshold. Before the fix, this scenario would
      // have reported "stalled" at the 3rd/4th check, never reaching here.
      let checks = 0;
      exists = async () => {
        checks += 1;
        return checks >= 5;
      };
      let t = 0;
      nextNow = () => {
        t += 10000;
        return t;
      };
    });

    when(/^I run the fallback download double$/, async () => {
      outcome = await runFallbackDownloadDouble(exists, nextNow);
    });

    then(/^the fallback outcome should be "(.*)"$/, (expected: string) => {
      expect(outcome).toBe(expected);
    });
  });

  test('Fallback ensureDownloaded double times out at 120 seconds when the file never appears', ({
    given,
    when,
    then,
  }) => {
    let outcome: string;
    let exists: () => Promise<boolean>;
    let nextNow: () => number;

    given(/^a fallback download double where the file never appears$/, () => {
      exists = async () => false;
      let t = 0;
      nextNow = () => {
        t += 15000;
        return t;
      };
    });

    when(/^I run the fallback download double$/, async () => {
      outcome = await runFallbackDownloadDouble(exists, nextNow);
    });

    then(/^the fallback outcome should be "(.*)"$/, (expected: string) => {
      expect(outcome).toBe(expected);
    });
  });
});

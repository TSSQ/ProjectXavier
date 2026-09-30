/**
 * The order an opportunistic auto-backup check runs in — cheapest first, so
 * the common outcome (nothing to do) reads almost nothing.
 *
 * It used to gather the WHOLE dataset (every account, category, payee,
 * transaction and series, decrypted through SQLCipher) before even checking
 * whether a backup was due — on every trip out of the app, Control Center
 * pulls included — and then threw the rows away, because the signature only
 * ever used dataRevision + settings (issue #27). Now: enabled? → too soon
 * since the last one? → cheap signature unchanged? → iCloud there? → only
 * then the backup itself, which does its own full read.
 *
 * Framework-free with injected I/O so the order is testable in Node.
 */
export interface AutoBackupIO {
  autoEnabled(): Promise<boolean>;
  /** The last backup's signature and time (0 when there has been none). */
  lastBackup(): Promise<{ sig: string | null; at: number }>;
  /** backupSignature from dataRevision + settings — no row reads. */
  signature(): Promise<string>;
  cloudAvailable(): Promise<boolean>;
  backup(): Promise<void>;
  record(sig: string, at: number): Promise<void>;
  now(): number;
}

export type AutoBackupOutcome = 'disabled' | 'too_soon' | 'unchanged' | 'no_icloud' | 'backed_up';

export async function runAutoBackupCheck(
  io: AutoBackupIO,
  minIntervalMs: number
): Promise<AutoBackupOutcome> {
  if (!(await io.autoEnabled())) return 'disabled';
  const last = await io.lastBackup();
  if (io.now() - last.at < minIntervalMs) return 'too_soon';
  const sig = await io.signature();
  if (sig === last.sig) return 'unchanged';
  if (!(await io.cloudAvailable())) return 'no_icloud';
  await io.backup();
  await io.record(sig, io.now());
  return 'backed_up';
}

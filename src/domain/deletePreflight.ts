/**
 * Permanent-delete iCloud preflight (QA MAJOR follow-up,
 * docs/design/account-chat-crud-spec.md §5.4/§5.5) — pure decision logic
 * for whether the manage-accounts screen should even OFFER the destructive
 * delete-confirm sheet, given whether iCloud is currently available.
 *
 * This is UX ONLY. The hard invariant — "never delete without a completed
 * forced backup" (CLAUDE.md guardrail #1) — is already enforced by
 * `deleteAccountCascade` itself: `forcePreDeleteBackup` (which uploads to
 * iCloud, `src/features/backup/icloud.ts`'s `uploadFile`) throws when
 * iCloud is unavailable, and `runAccountDeleteCascade`
 * (src/domain/accountDeleteCascade.ts) aborts BEFORE any destructive
 * statement runs when that happens — so a stale/incorrect preflight result
 * can never let an unbacked-up delete through; it can only produce a worse
 * error message. This function exists purely so the screen can give an
 * ACTIONABLE message up front ("sign in to iCloud") instead of a generic
 * "could not delete, try again" after a doomed attempt.
 */
export interface DeletePreflightResult {
  /** False means the screen should not even open the destructive sheet. */
  allowed: boolean;
  /** Actionable, user-facing message when `allowed` is false; null when
   *  `allowed` is true (nothing to say). */
  message: string | null;
}

export function checkDeletePreflight(icloudAvailable: boolean): DeletePreflightResult {
  if (icloudAvailable) return { allowed: true, message: null };
  return {
    allowed: false,
    message:
      'Sign in to iCloud to delete — Xavier backs up your data before a permanent delete.',
  };
}

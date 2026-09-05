/**
 * The actual save SEQUENCE behind `saveAssistantDraft` (src/features/ai/
 * saveDraft.ts), factored out so it's directly BDD-testable in the plain-Node
 * suite with a fake repository — same seam as `queryLoop.ts`'s injected
 * `QueryToolExecutor` (see that file's header): every DB/id/clock operation
 * is a parameter (`SaveAssistantDraftDeps`), so this file itself imports
 * nothing native (no Drizzle/expo-sqlite, no expo-crypto), and can be
 * `import`ed in Node without ever touching a real DB.
 *
 * QA (docs/design/stale-draft-spec.md follow-up) deleted the write-boundary
 * guard's call line from `saveAssistantDraft` by hand and the FULL suite
 * stayed green — 106 suites, 1872 tests. That is the gap this file closes:
 * `assertDraftIsSaveable` was only ever exercised in isolation
 * (draft-integrity.feature), never as part of the sequence that actually
 * calls it, so nothing pinned that it runs, or that it runs before any
 * write. See tests/__features__/save-draft-sequence.feature — it asserts
 * BOTH that the guard rejects (no `deps.*` write call happens at all) and
 * that a valid draft's calls land in the right order (guard's own
 * `listAccounts` read, then category/payee resolution, then
 * create/transaction, in that order).
 */
import { TransactionDraft, buildTransaction } from '../../domain/assistant';
import { assertDraftIsSaveable } from '../../domain/draftIntegrity';
import { resolveCategoryId } from '../../domain/payees';
import { buildRecurringSeries } from '../../domain/recurrence';
import { Account, Payee, RecurrenceRule, RecurringSeries, Transaction, TransactionType } from '../../domain/types';

/** Every native/DB-bound operation `saveAssistantDraftWith` needs, as a
 *  parameter rather than a top-level import — the seam that makes this file
 *  Node-testable. `saveDraft.ts` wires the real Drizzle repositories + newId
 *  + Date.now here; a test wires fakes. */
export interface SaveAssistantDraftDeps {
  listAccounts(): Promise<Account[]>;
  findOrCreateCategory(name: string, type: TransactionType): Promise<string>;
  getPayeeByName(name: string): Promise<Payee | null>;
  findOrCreatePayee(name: string, defaultCategoryId: string | null): Promise<string>;
  createSeries(series: RecurringSeries): Promise<void>;
  createTransaction(tx: Transaction): Promise<void>;
  postDueOccurrences(now: number): Promise<void>;
  newId(): string;
  now(): number;
}

/**
 * Persist a confirmed assistant draft as a real transaction, against
 * `deps` rather than a real DB. See `saveAssistantDraft` (saveDraft.ts) for
 * the public, real-repository-wired entry point every screen calls — this
 * function is that one's entire body, parameterised.
 *
 * Resolves the draft's free-text category/payee names to ids and applies the
 * payee↔category rules:
 *  - A brand-new payee is created silently and adopts the draft's category as
 *    its first-used default.
 *  - An existing payee with no explicit category contributes its learned
 *    default ("prefer learned default").
 * Transfers have neither (interpret() always sets both null — see
 * TransactionDraft), so that machinery is skipped entirely for them.
 * Then assembles a Transaction via the pure domain helper and writes it
 * through `deps.createTransaction`. Returns the saved id.
 */
export async function saveAssistantDraftWith(
  deps: SaveAssistantDraftDeps,
  draft: TransactionDraft,
  /** When present, the draft starts a RECURRING SERIES instead of a one-off:
   *  a schedule is created ALONGSIDE the transaction — the row is still
   *  written and returned, now tagged with the series. Same behaviour the
   *  transactions FAB has; the assistant's editor simply had nowhere to put a
   *  repeat rule, so its form hid the control (see `showRepeat`). */
  repeatRule?: RecurrenceRule | null,
  /** Create the occurrences between a PAST start date and today. The assistant
   *  screen asks before setting this — see app/(tabs)/index.tsx. No default:
   *  every caller must decide, and typecheck names the ones that have not. */
  backfill = false
): Promise<string | null> {
  // Write-boundary guard (docs/design/stale-draft-spec.md §3.1) — checked
  // against the DB's CURRENT account list (`deps.listAccounts()`, not
  // whatever the screen's own possibly-stale accounts state believes), and
  // before any other write (payee/category find-or-create included) so an
  // invalid draft leaves no trace at all. Throws a typed error the screen
  // catches and explains; see src/domain/draftIntegrity.ts for why this
  // exists and what it closes. THIS LINE, in this position, is the fix —
  // see this file's own header for why it's pinned by a test rather than
  // trusted to stay here by inspection alone.
  assertDraftIsSaveable(draft, await deps.listAccounts());

  let categoryId: string | null = null;
  let payeeId: string | null = null;
  let seriesId: string | null = null;
  let occurrenceDate: number | null = null;

  if (draft.type !== 'transfer') {
    const explicitCategoryId = draft.categoryName
      ? await deps.findOrCreateCategory(draft.categoryName, draft.type)
      : null;
    categoryId = explicitCategoryId;

    if (draft.payeeName) {
      const existing = await deps.getPayeeByName(draft.payeeName);
      // No explicit category? fall back to the payee's learned default.
      categoryId = resolveCategoryId(explicitCategoryId, existing);
      payeeId = existing
        ? existing.id
        : // New payee: remember this category as its first-used default.
          await deps.findOrCreatePayee(draft.payeeName, categoryId);
    }
  }

  if (repeatRule) {
    // A repeat rule adds a SCHEDULE; it does not replace the transaction the
    // user just confirmed. The row is still created below, tagged with the
    // series, and the schedule runs from there — see buildRecurringSeries for
    // why the poster must not mint that first occurrence itself.
    const series = buildRecurringSeries({
      id: deps.newId(),
      rule: repeatRule,
      occurredAt: draft.occurredAt,
      createdAt: deps.now(),
      // This used to be hardcoded false, on the reasoning that a confirm-card
      // flow is the wrong place to ask about months of history — and that the
      // charges could be added later from the transactions screen instead.
      // That second half was simply wrong: the transactions screen only asks
      // while CREATING a series, so there was no way back. Reported from the
      // beta by someone who set a 2025 date in Xavier's editor, got no prompt,
      // and no earlier charges. The editor is where the date was chosen, so
      // the editor is where the question belongs.
      backfill,
      template: {
        accountId: draft.accountId,
        type: draft.type,
        amount: draft.amount,
        currency: draft.currency,
        categoryId,
        payeeId,
        transferAccountId: draft.transferAccountId ?? null,
        note: draft.note,
      },
    });
    await deps.createSeries(series);
    seriesId = series.id;
    occurrenceDate = series.rule.anchor;
    // postDueOccurrences deliberately runs AFTER the transaction below, not
    // here — see the note at the call site.
  }

  const tx = buildTransaction(draft, {
    id: deps.newId(),
    createdAt: deps.now(),
    categoryId,
    payeeId,
  });

  // createTransaction validates with zod and inserts via bound parameters.
  await deps.createTransaction(seriesId ? { ...tx, seriesId, occurrenceDate } : tx);

  // Only now is it safe to post. postDueOccurrences skips an occurrence when a
  // row already exists for (seriesId, occurrenceDate), and this row IS the
  // anchor occurrence — so running it before the insert means the guard has
  // nothing to find, the poster mints the anchor itself, and the insert then
  // adds a second row on the same day.
  //
  // That stayed hidden while backfill was hardcoded false: the series carried
  // lastPostedAt = max(anchor, today) and postedCount 1, so nothing was ever
  // due at the anchor. Turning backfill on made the anchor due and the
  // duplicate appeared immediately — reported from beta 80 as two Disney and
  // three Netflix rows stacked on one day.
  //
  // app/(tabs)/transactions.tsx has always had this order; this file did not.
  if (seriesId) await deps.postDueOccurrences(deps.now());
  return tx.id;
}

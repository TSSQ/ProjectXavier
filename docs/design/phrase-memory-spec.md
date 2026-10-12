# Phrase memory: the per-user correction loop

Status: shipped behind no flag (on-device, no network). Code:
`src/domain/phraseMemory.ts` (pure rules), `src/features/phraseMemory/`
(store + best-effort writes), wired in `app/(tabs)/index.tsx` (`runParse`,
"Log anyway", discard, reverts), `src/features/ai/saveDraftSequence.ts`
(save) and the transaction editors. BDD: `tests/__features__/phrase-memory.feature`,
`tests/__features__/phrase-memory-backup.feature`.

## Why

People phrase things differently. The fixed lists in the parse pipeline
(the not-a-transaction cues, the transaction affirmation's vocabulary in
`src/domain/fmRefusal.ts`, the sign reader) are a seed that fits most users
most of the time. What a user corrected last time for the same words is
better evidence for that user, so it overrides them.

## Key

`phraseKey(text, now)`: the user's words minus every amount and the currency
marks beside it (`readAmounts`), minus the date phrase the pipeline reads
(`typedDateSpan`), lowercased, punctuation stripped, whitespace collapsed.
"12 on lunch", "12 on lunch?" and "$15 on lunch yesterday" share `on lunch`.
An empty key (a bare amount) or one of more than 8 words (a receipt's OCR
text) is never stored or looked up. Lookup: the exact key, else the one row
whose key is a whole-word variant (`isWholeWordVariant`), else nothing (two
variants are ambiguous).

## What it stores (`phrase_memory`)

`key` (primary key), `verdict` ('log' | 'not_log' | null), `type`,
`category_id`, `payee_id`, `account_id`, `hits`, `reverts`, `last_used_at`,
`updated_at`. Capped at 2000 rows, least recently used evicted on write.

| event | write |
|---|---|
| an AI draft is saved | the saved type/category/payee/account under the key; hits + 1; a 'not_log' verdict becomes 'log' |
| an AI-sourced transaction is edited after saving (chat edit, Transactions tab, account screen) | the same, from the edited row |
| "Log anyway" on a refusal | verdict 'log' |
| a draft that code affirmed (the model refused) is discarded | verdict 'not_log' |
| a field the memory applied is reverted on the card | reverts + 1; deleted at 2 |

Every write is best-effort: it never fails the save or the tap, and no user
text reaches a log.

## How it is read

`runParse` loads the rows once per parse.

- **Verdicts.** 'log': the expense engines run as under "Log anyway" (never
  refused — the cue check and the model's refusal are both overridden; the
  query, account and budget gates are not). 'not_log': when code affirmed a
  model refusal (`FmParseOutcome.affirmed`), the refusal is kept. The model's
  own "this is a transaction" is never overridden.
- **Fields.** `applyMemory` runs on every engine's confirm draft before the
  payee's learned defaults. Precedence: a field the user typed (the type when
  the words decide it via `readSign`; the category or payee when the draft's
  value appears in the text, `mentionedInText`; the account when the engine
  named one) > phrase memory > the payee's learned default > the engine.
  Transfers are never touched. A type is applied only with a category of its
  kind (or none). Each applied field is flagged with the existing "as last
  time" / revert affordance (`learnedCategory`, `learnedAccount`, plus
  `learnedType`, `learnedPayee`, with `source: 'phrase'`).

## Privacy and backup

The key is the user's own words, like `transactions.source_text`: kept in the
encrypted local database, included in the user's own backups (an optional
table, so older images restore with an empty memory; every restored row is
zod-validated), never in a parse metric or a log. Parse metrics record only
a fixed enum (`{"phraseMemory": "applied" | "forced_log" | "kept_refusal"}`),
and the debug screen's "By engine" block shows memory applied / kept.

## Not done

- No developer endpoint, no sync: the memory is per device.
- The eval harness is unaffected: the memory is empty there.
- The optional "worked examples in the BYOK cloud prompt" idea is not built
  (unmeasured, and it would change the cloud prompt).

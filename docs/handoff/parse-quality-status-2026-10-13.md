# Parse quality: stock-take (2026-10-13)

Single source of truth for where the 2026-10-10 parse-quality effort stands.
Plan: `parse-quality-plan-2026-10-10.md` (same folder). Everything below is
on `main` unless marked open.

## Merged (main)
| PR | What |
|---|---|
| #41 | Learned payee category/account win over the engine's guess |
| #42 | BYOK: currency-aware amounts, temperature 0 (gated per model), gpt-4.1-mini default, key-failure notice |
| #43 | Sign reader + affirmation (later narrowed by #49) |
| #44 | Per-engine parse metrics, on-device correction loop |
| #46 | Step-2/3 contract (refuse rule, closed category, code-read amount) on the BYOK cloud engines |
| #47 | BYOK: `rejected` failure reason, non-JSON reply = bad_output, debug currency, cloud date rule |
| #48 | Learned defaults: kind guard, best-effort learning, metrics by intent, corrections privacy, append-only file |
| #49 | Affirmation = positive shape rule; date phrase stripped from the model's text; ytd/tdy aliases; sign-reader fixes |
| #51 | FM dev rerun after #49: 304/318 (95.6%), 0 regressions |
| #52 | Phrase memory: per-device learning of each user's corrections, verdicts, revert counting |
| #53 | Automatic per-field correction capture (from/to per field, engine, applied defaults) + developer screen |
| #54 | BYOK Anthropic default -> claude-haiku-5-5; eval reference re-pointed (reference run not yet re-measured) |

## Open
- **#45** capped grounding lists. Fix pushed 2026-10-12 (keep caller order, cap payees past 20, word-overlap offers).
  Mac dev run after the fix: 7 cases recovered, 0 regressions vs main, 9/12 new `dv-cap-*` cases pass.
  Waiting on the owner: holdout look (1 of the limited looks) then merge.
- **#50** budgets empty-month copy (unrelated; from the Mac session).
- **#5** stale Codex PR from June (unrelated; close or rebase).

## Measured
| Engine | Before (2026-10-03) | Now |
|---|---|---|
| On-device FM, dev parse | 87.2% (254/280 reliable) | 95.6% (304/318), 0 regressions |
| Heuristic, dev | 52% | 150/292 after sign reader (no regressions) |
| Anthropic BYOK | 92% all (Haiku 4.5, old contract) | not re-measured on Haiku 5.5 + new contract |
| OpenAI BYOK | 82% all (gpt-4o-mini) | not re-measured on gpt-4.1-mini + new contract |

## Pending decisions (owner)
1. #45: approve the holdout look and merge.
2. Cloud re-baseline scope: dev-only (cheap, confirms the port) / all + reference run (restores the FM-vs-BYOK gate) / skip.
3. Correction capture is automatic in test builds (METRICS_ENABLED only); opt-in toggle wanted or not.

## Not built (by choice)
- BYOK worked-examples from phrase memory in the cloud prompt (unmeasured; parked).
- Anthropic request on structured outputs instead of forced tool choice (needed only for Opus 5.5 / Sonnet 5.5 / Fable 5.1 pickers; users on those see the "model rejected the request" notice).
- Any developer-operated telemetry endpoint (policy decision; corrections stay on-device, shared by hand).

## Sessions
Cloud worker sessions (tag `parse-quality-2026-10-10`) are all idle/complete and can be archived.
Mac Remote Control session "Cut build 122 beta on pigu" holds the FM probe and the provider keys.

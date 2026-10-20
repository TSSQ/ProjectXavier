# Ship run: byok-consent

- **Feature:** Per-provider consent before BYOK sends anything to OpenAI/Anthropic (App Store guideline 5.1.2(i)), for v2.0.0
- **Branch:** claude/v2.0.0
- **Spec:** docs/design/byok-consent-spec.md
- **Started / finished:** 2026-10-20 / 2026-10-20

## Spec
User chose "Add consent prompt (Recommended)" during v2.0.0 release prep. BYOK shipped in 1.2.1 with no prompt, so upgraders are handled: enabled-without-consent is inert, with a visible notice.

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS (condensed). No blockers/majors: every path carrying user content to a provider goes through the single `byokActive` gate in `app/(tabs)/index.tsx` feeding `routeEngines` (expense parse, query loop, account create/update, transaction op). Minors: debug-byok ungated (METRICS-flag only); weak source guard; double-tap could queue two alerts; provider default 'openai' before load could record consent for the wrong provider (fails safe); `byokActive` ignored its `provider` arg.
Resolution: structural per-provider `consents` map, import-allowlist guard, `promptingRef` double-alert guard, `loaded` gate on the controls.

## Review
Round 1 — **verdict:** REQUEST-CHANGES (condensed). Blocking: consent copy said only "the text you send" leaves the device, but every parse also sends up to 30 category, 20 payee and all account names as grounding, and questions send tool results (balances via net_worth, up to 20 matching transactions via search_transactions, top_payees). Suggestions: one-time upgrader chat note; debug-byok should honour consent; hostname guard.
Resolution: copy + subtitle + spec corrected and pinned by BDD ("account", "payee", "transactions"); upgrader hero note with device-local seen flag; debug-byok gated; hostname guard. The public privacy policy had the same understatement — corrected separately on gh-pages (50b3055, pending the user's approval to publish).

Round 2 — **verdict:** APPROVE-WITH-NITS. Nits applied: re-check the paused note on focus; drop its state only after `moving`; comment on the reset-note precedence; `hint ? … : null`.

## Verify
```
npm run typecheck  → clean
npm run lint       → clean
npm test           → Test Suites: 187 passed, 187 total / Tests: 3895 passed, 3895 total
npm run eval       → PASS — at or above baseline (split=dev, 47.9%), no case regressed.
```

## Build
- Ships in the v2.0.0 store build (152).

# ProjectXavier — Session Handoff

_Last updated: 2026-06-25. Keep this file current at the end of each session._

This is the single "catch-up" doc for a new session taking over. Read it top to
bottom; it should leave nothing hanging.

---

## 1. Snapshot — where things stand

- **Feature branch (develop here, never push `main` without permission):**
  `claude/expense-tracker-app-y7rgas`
- **Open PR:** none. Branch reset to `origin/main` after the last merge; working
  tree clean. Open a new PR for the next feature.
- **Merged so far:** #11 (de-typed accounts, app-level currency, transfers,
  notes, payee/category comboboxes, assistant fuzzy-merge), #12 (workflow
  mockups doc + "always watch PRs" convention), #13 (dashboard period overview),
  #14 (consistent period scoping + animated avatar + avatar-look picker), #20
  (avatar settings behind a tappable header), #21 (currency picker behind
  tappable header + full ISO 4217 list), **#22 (AI proxy abuse & cost controls —
  per-IP rate limit, per-user daily quota of 5/day free tier, response cache,
  `verify_jwt` at the gateway; Upstash Redis REST store)**.
- **Verification status:** `typecheck` + `lint` + BDD suite all green.

To resume: `git fetch`, make sure you're on the feature branch and up to date
with `origin/main`, run the checks (§4), then continue. **Always** open/keep a PR
and **subscribe to it** (`subscribe_pr_activity`) — see §8.

---

## 2. What the app is

Expo / React Native (Expo Router) personal expense tracker. North star: the
**laziest user** can describe or snap an expense and an avatar-driven assistant
("Xavier") logs it. Local SQLite is the source of truth; an AI proxy parses
free text/OCR into structured transactions.

**Stack:** Expo SDK 52, expo-router 4, TypeScript, Drizzle ORM + expo-sqlite,
NativeWind (Tailwind), react-native-svg, react-native-reanimated, zod,
Supabase (auth + future sync), DiceBear (legacy avatar, now unused), jest +
jest-cucumber for BDD.

---

## 3. Architecture & conventions (from CLAUDE.md — non-negotiable)

- **Verify before you push:** `npm run typecheck`, `npm run lint`, `npm test`
  must all be green.
- **Domain logic is framework-free** (`src/domain/**`): no RN/Expo imports, so
  the BDD suite runs in plain Node. Put testable logic here.
- **Parameterised SQL only** (Drizzle / `src/db/sql.ts`) — never concatenate
  values. Proven by `tests/__features__/input-safety.feature`.
- **Validate every trust boundary with zod** (`src/lib/validation.ts`),
  including AI/OCR output (treat as untrusted).
- **Auth before financial data**; biometric app-lock gate.
- **Online endpoints behind WAF + rate limiting** (AI proxy).
- **PR workflow:** one PR per feature branch; after a feature is complete +
  green + pushed, ensure an open PR into `main`; **always subscribe to open PRs**
  and triage CI/review until merged or closed. Use GitHub MCP tools only.
- **Design-first workflow:** for UI changes we **draft an HTML mockup, get
  approval, then code**. The committed source of truth is
  `docs/design/workflows.html` (currently **rev 8**).

### Layout map
- `app/` — Expo Router screens:
  - `(tabs)/index.tsx` — Assistant home (chat + draft card + animated avatar)
  - `(tabs)/dashboard.tsx` — period overview (Period sheet, trend chart, accounts)
  - `(tabs)/transactions.tsx` — period-scoped ledger (FAB + sheet + search)
  - `(tabs)/settings.tsx` — currency picker, **avatar look picker**, backup stubs
  - `account/[id].tsx` — account detail (period-scoped from dashboard, all-time from manage)
  - `manage-accounts.tsx` — clean list + sheet add/edit (+ "View transactions")
  - `period.tsx` — **orphaned** old period-detail screen (see §7)
- `src/domain/` — pure logic: `types`, `money`, `balances`, `period`, `payees`,
  `assistant`, `avatar`
- `src/features/<area>/repository.ts` — DB access (accounts, transactions,
  categories, payees, settings, ai, auth, ocr)
- `src/db/` — `schema.ts` (Drizzle), `migrate.ts` (DDL, create-if-not-exists),
  `sql.ts` (parameterised builders), `client.ts`
- `src/components/` — `AssistantAvatar` (single avatar swap point) + `ui/*`
- `src/lib/` — `validation`, `backup`, `crypto`, `accountIcon`, `accountColor`,
  `grouping`, `id`, `secureStore`, `supabase`
- `tests/__features__` + `tests/__steps__` — BDD; `tests/support/` helpers
  (`world.ts` builders, `fakeDb.ts`, `nodeCrypto.ts`)
- `docs/` — `SECURITY.md`, `RUNNING.md`, `adr/`, `design/workflows.html`

---

## 4. How to verify

```bash
npm run typecheck   # tsc --noEmit (covers app/ + src/ + tests/)
npm run lint        # eslint
npm test            # jest-cucumber BDD (38 tests / 10 features)
```
There is also `npm run e2e` (Maestro, `e2e/*.yaml`) — **not run in CI here** and
needs a device/build; keep the yaml roughly in sync but don't rely on it.

---

## 5. Features implemented (current behaviour)

- **Accounts are not typed** (no asset/liability). Net worth = **signed sum of
  every account balance**; a credit card is just a negative balance. Accounts
  carry an optional, cosmetic `tag`. (`balances.ts`, `accountIcon.ts`)
- **Currency is a single app-level setting** (no per-account currency, no FX),
  chosen in Settings; stored in the `settings` table. Default `SGD`.
- **Transactions:** expense / income / **transfer**. Transfers move between the
  user's own accounts (net-worth-neutral) and render in **grey**. Every
  transaction can carry an optional **note**.
- **Payees & categories** are searchable **comboboxes** with inline create
  (`Combobox`). Picking a payee **auto-fills its first-used default category**.
  - Pure resolution logic in `domain/payees.ts`: `normalizeName`,
    `editDistance`, `findPayeeMatch` (exact + fuzzy "did you mean…?"),
    `resolveCategoryId` (prefer learned default).
  - Assistant reconciliation is **on-device** (no extra AI call): the single
    parse returns a payee name; `findPayeeMatch` flags close duplicates. The
    draft card shows a "Did you mean X?" merge prompt. New payees are created
    silently on save with their first-used category.
- **Dashboard = period overview.** A **period button** opens the **Period sheet**
  (`PeriodSheet`: Month / Year / Date). Shows **net worth at the period end** +
  a **per-account trend chart** (`MultiLineChart`, one line per account, legend +
  colour pins via `accountColor`), the period's **income / expense / net
  savings**, and each account's **closing balance** rolled forward from the prior
  period. Domain: `accountBalanceAsOf`, `netWorthAsOf`, `accountPeriodBalances`,
  `balanceSeries`.
- **Period scoping is consistent:** the **Transactions tab** uses the same period
  button/sheet and shows only the period's entries (search filters within).
  **Account detail** is period-scoped when opened **from the dashboard**
  (receives `start/end/label` params → balance as of period end + that period's
  transactions) and **all-time** when opened from **Manage accounts → View
  transactions** (no params). Manage-accounts management itself is not scoped.
- **Clean UI:** add/edit live in a reusable **`BottomSheet`**, not inline forms.
  Transactions has a **floating + (FAB)** bottom-right + **tap-to-reveal search**;
  Manage accounts has back (left) and **+ then 🔍** (right), tap a row to edit,
  archive from the sheet header.
- **Animated avatar (Phase 1):** `XavierPet` — an SVG gradient blob animated with
  Reanimated; always alive (breathe + blink) and reacts to assistant state:
  **idle / listening / thinking / happy / confused**. `avatarStateFor`
  (pure, tested) maps signals → state. `AssistantAvatar` is the single swap point
  and reads the chosen **look** on focus.
- **Avatar look picker:** Settings → "Assistant avatar" — colour looks
  (`AVATAR_LOOKS`: Xavier/Mint/Sunset/Gold/Grape/Slate), persisted via
  `getAvatarLook/setAvatarLook`. `lookById` falls back to default.
- **Backup format** is settings-aware: `BackupData.settings` round-trips (e.g.
  currency). Backup is encrypted (AES-256-GCM) via an injected `CryptoProvider`.

---

## 6. Key decisions / ADRs

- **ADR 0002 (accepted): plain SQLite at rest** — local DB is **not** encrypted
  by us; at-rest relies on OS device encryption + the biometric gate. Backups/
  sync remain E2E-encrypted. **ADR 0001 (SQLCipher) is superseded/rejected** but
  kept as the path to revisit (see its "revisit criteria"). Do **not** re-add
  SQLCipher without a new decision.
- **Backup/restore is deferred** (user's call). The format + crypto interface +
  repo helpers exist and are tested, but the **UI wiring and an Expo
  `CryptoProvider` implementation are NOT built** (see §7).
- **Fuzzy merge is local** (edit-distance), never an AI call — keep it that way
  for cost; semantic matching would need embeddings.
- **Avatar:** Phase 1 = SVG + Reanimated (done). Phase 2 = Rive (reactive) or
  Lottie (canned) — both need a dev/EAS build.

---

## 7. Open items / follow-ups (nothing is "in progress" — these are TODOs)

1. **Backup/restore UI + crypto impl.** Settings "Export/Restore" are
   `Alert` stubs. Needed: an Expo `CryptoProvider` (AES-GCM via WebCrypto
   `globalThis.crypto.subtle` in Hermes, or a native module — `expo-crypto`
   does NOT do AES-GCM), file write/share (`expo-file-system` + `expo-sharing`),
   document-picker import, passphrase/recovery-key UX, and transactional
   gather-from-repos / apply-to-DB. Recommended key model: device-random local
   key (if SQLCipher ever) + **user passphrase/recovery key for portable
   backups**. (Deferred by user; revisit when asked.)
2. **`app/period.tsx` is orphaned** — the old period-detail screen is no longer
   linked. Either delete it or repurpose. Left in place intentionally.
3. **Dashboard top-right search / ⋯ icons are visual placeholders** (no handler).
   Wire or remove.
4. **Assistant logs `occurredAt = now`** → new entries land in the *current*
   month. If you're viewing a past period on the Transactions tab you won't see a
   just-added entry until you switch back. Expected; consider auto-jumping to the
   current period after a save if the user wants it.
5. **Avatar Phase 2** (Rive/Lottie) and **AI-generated avatar art** — the latter
   needs an image-generation MCP connected. Could also: vary avatar shape/face
   (not just colour), live mini-pet swatches, random re-seed.
6. **Cloud sync (Tier 2)** — deferred; only justified for multi-device /
   cross-platform. OS device backup covers basic recovery for free.
7. **Figma** — there IS a Figma file `ProjectXavier — Workflow Mockups`
   (`file_key bsAdn2ueflUegeT6wIkscV`, team **T**, account "Terrence") built to
   ~rev 1. The Figma MCP **keeps disconnecting**; it only registers at session
   start, so to update it: enable the connector, start a FRESH session, then
   regenerate from `docs/design/workflows.html` (now rev 8). Until then the HTML
   is the source of truth.
8. **Remaining abuse/cost layers (deferred by user — "leave it aside for now").**
   #22 closed the day-one denial-of-wallet gap at the AI proxy (rate limit +
   5/day quota + cache + `verify_jwt`). Still to do, when asked:
   - **Turnstile (or hCaptcha) on signup** — the proxy's per-user quota can't stop
     cheap account-farming; a bot-check at signup closes that vector.
   - **Cloudflare WAF + DDoS** in front of all endpoints — `docs/SECURITY.md` #3
     lists this as *planned*, not built. Provision it, then update that row to
     "built" so the doc and reality agree.
   - **Production-boot assertion** — the parse function fails *open* (no limit) and
     only logs a warning if `UPSTASH_REDIS_REST_URL`/`_TOKEN` are unset
     (`_shared/store.ts`). Add a loud startup check so a missing secret in prod is
     obvious instead of silently disabling all throttling.
   - Required prod secrets for the proxy: `UPSTASH_REDIS_REST_URL`,
     `UPSTASH_REDIS_REST_TOKEN` (read-write). Optional tuning: `AI_DAILY_QUOTA`
     (default 5), `AI_RATE_LIMIT_PER_MIN` (20), `AI_CACHE_TTL_SECONDS` (86400).
     See `backend/README.md`.

---

## 8. Environment quirks (important — avoid dead ends)

- **Remote sandbox**, fresh clone per session; only committed+pushed work
  survives. Use the scratchpad for temp files.
- **GitHub:** no `gh`/git API — use **GitHub MCP tools** (`mcp__github__*`).
  Repo scope is `tssq/projectxavier` only.
- **PR watching:** `subscribe_pr_activity` after a PR exists; triage CI failures
  + review comments until merged/closed. Webhooks do NOT deliver CI *success*,
  new pushes, or merge-conflict transitions.
- **`send_later` is NOT available** here and the sandbox can't poll GitHub from a
  shell, so you cannot auto-schedule the hour-out PR re-check. Rely on webhooks;
  if you need to confirm CI/merge state, query via MCP (`pull_request_read`).
- **EAS / Expo build servers are network-blocked** by the environment policy —
  you cannot run `eas build` or verify native modules here. Anything needing a
  dev/native build (SQLCipher, Rive, Lottie) must be verified outside the sandbox.
- **No new native dependencies** can be runtime-verified here. Prefer solutions
  using libraries already installed (reanimated, svg) for in-sandbox work.

---

## 9. Git / push routine

```bash
# develop on the feature branch
git checkout claude/expense-tracker-app-y7rgas
git fetch origin && git merge --ff-only origin/main   # or merge if diverged
# ...changes... then verify (§4)
git add -A && git commit -m "..."   # end commits with the Co-Authored-By + Claude-Session trailers
git push -u origin claude/expense-tracker-app-y7rgas  # retry w/ backoff on network errors
```
Commits land on the open PR (one PR per branch). When the open PR merges, the
branch fast-forwards to `main` on the next `fetch`; start the next feature from
there. Open a **new** PR for new work (don't reopen merged PRs).

Commit/PR trailers to use:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0162BLsB3CjVjytQif3u6DrN
```
PR bodies end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## 10. Quick "first 5 minutes" checklist for the next session

1. `git fetch`; confirm branch + clean tree; check open PR (#14 or its successor)
   state via `pull_request_read` and **subscribe** to it.
2. Run `npm run typecheck && npm run lint && npm test` — expect green (38 tests).
3. Skim `docs/design/workflows.html` (rev 8) for the current UX.
4. Pick up from §7 TODOs or the user's new request. For UI work, **draft HTML
   first**, get approval, then code.
5. Keep this file updated before you finish.

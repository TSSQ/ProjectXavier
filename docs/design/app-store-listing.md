# App Store listing copy — Xavier / Tae's Expense Tracker

Draft copy for App Store Connect. Every claim here matches what the app actually
does (cross-checked against the code + `app-store-submission.md`). Character
limits are Apple's; counts noted so nothing gets truncated at submit.

> **Name decision (pick one before submitting):** the TestFlight build shows
> **"Tae's Expense Tracker"**, but the in-app assistant is **Xavier**. Options:
> (a) **Xavier — Expense Tracker** (leans on the assistant brand), (b) **Tae's
> Expense Tracker** (current), (c) **Xavier: Private Expenses**. Copy below is
> written to work with either; swap the name token as chosen.

---

## App Name (≤30 chars)
`Xavier — Expense Tracker` *(24)*
Alt: `Tae's Expense Tracker` *(21)*

## Subtitle (≤30 chars)
`Private, on-device, just talk` *(29)*
Alts:
- `Just say it. Stays private.` *(27)*
- `On-device expenses, no cloud` *(28)*

## Promotional Text (≤170 chars — editable anytime without review)
`Track spending by just telling Xavier — "lunch 12.50 at Subway." It's parsed right on your iPhone. No account, no cloud, no tracking. Your money stays yours.` *(156)*

## Keywords (≤100 chars, comma-separated, no spaces after commas)
`expense,budget,tracker,private,offline,on-device,spending,money,finance,receipt,no account,ai,local` *(99)*

## Description (≤4000 chars)

Xavier is an expense tracker that does one thing differently: it keeps
everything on your iPhone. No account to create, no cloud to sync to, no
analytics, no ads. You just tell it what you spent.

JUST SAY IT
Type or paste what happened — "lunch 12.50 at Subway," "SGD 40 taxi," "coffee
4.20" — and Xavier turns it into a clean transaction. The parsing runs on-device
with Apple Intelligence; your words never leave your phone. Every entry shows
you a confirmation card before it's saved, so nothing is logged without your OK.

PRIVATE BY DESIGN
- No sign-up, no email, no account — ever.
- No servers. The app has no network connection for your financial data.
- Your database is encrypted at rest on the device.
- Optional Face ID lock, off by default — turn it on when you want it.
- No third-party tracking or advertising SDKs.

EVERYTHING YOU NEED
- Snap or import a receipt and let Xavier read the total.
- Recurring transactions for rent, subscriptions, and salary.
- A Home Screen widget with this month's income and expense at a glance —
  which hides itself when your phone is locked.
- Multiple accounts (bank, cash, credit card, savings).
- Categories, payees, and clear monthly summaries.

YOUR DATA, YOUR BACKUP
Back up to your own iCloud whenever you like, and restore with a tap. The backup
is a copy of your own database in your own iCloud space — not ours. We never see
it.

BUILT FOR MODERN iPHONE
Xavier uses on-device intelligence for the natural-language magic. On devices
without it, you can still add and edit everything by hand — the core tracker
works for everyone.

No subscription. No upsell. Just a private place to see where your money goes.

*(~1,530 chars — well under 4,000; room to expand if you want.)*

## What's New

### v1.1.1 (build 74 — ready to submit)

A patch release. Everything here is a fix to something that shipped in 1.1,
so the notes lead with the two that could actually cost the user something:
an app that stopped responding, and a lock that stopped locking.

```
Fixes for a freeze when setting up repeating transactions, and for the
Face ID lock.

• Fixed: creating a monthly or yearly repeating transaction could leave the
  app unresponsive, with an empty dashboard.
• Improved the reliability of the Face ID lock — if Face ID becomes
  unavailable, the app now asks for your device passcode.
• Fixed: turning the lock on could say "Face ID isn't set up on this device"
  when Face ID was set up and the app simply hadn't been allowed to use it.
  It now names the setting to change and takes you there.
• Fixed: today's recurring charges were missing from your balances and
  totals until midday, and were wrongly labelled "Upcoming".
• Upcoming now names what's due — "Netflix", not "Expense".
• Fixed: Xavier no longer warns about a currency you never mentioned.
• Xavier now keeps a short note from your own words ("as credit card
  payment", "with the team") and shows it before you save.
• The repeat option is now available when you edit a transaction from
  Xavier, matching the + button.
```

*(~1,050 chars.)*

**On the Face ID wording (decided):** the plain version of that bullet read
"the Face ID lock could stop protecting the app if Face ID was later changed,
removed, or never permitted". Softened at the author's direction, because it
also tells people still on 1.1 that their lock may not be working. What was
deliberately KEPT is the passcode clause: users of the old build will meet a
passcode prompt where the app previously just opened, and release notes that
soften a security fix must still not hide a behaviour change the user is
about to run into. The full, unsoftened description of the defect lives in
commit `bcadd53` and in `src/domain/biometricLock.ts` — softening the store
copy does not soften the record.

**One decision left before publishing:**

1. **Anyone updating 1.0 → 1.1.1 sees only these notes** on the update
   screen; 1.1's feature notes move into version history. If a meaningful
   number of users skipped 1.1, consider appending one line — "Also new since
   1.0: ask Xavier about your spending, edit and delete by asking, swipe
   actions, future-dated transactions, account archiving, optional BYOK."

**Verified against the build** (each line traced to a commit on main at
07c112e, the commit build 74 was cut from): freeze `e7ac440`, Face ID
`bcadd53`, day-granular totals `e55fea0`, naming `9c9e120`, currency
`f0bca8c`, notes `1f1a9c0`, repeat parity `eb64e5f`.

### v1.1 (shipped)

Xavier now answers questions, not just records them.

```
Ask Xavier where your money went — "how much did I spend on dining last
month?", "this month vs last month" — and get a real figure or a chart,
worked out on your device.

You can now edit and delete transactions and accounts just by asking. Xavier
finds the matching entries and you pick the one you meant; nothing changes
until you confirm.

• Swipe left on any transaction to copy or delete it
• Enter transactions dated in the future — they wait until the day arrives
  instead of skewing this month's totals
• Archive accounts you've closed: they leave your totals and pause their
  recurring rules, but nothing is deleted and you can restore them anytime
• Optional: add your own OpenAI or Anthropic key for sharper answers. Off by
  default, and your questions go straight from your phone to that provider —
  we never see them, because we don't run a server.
```

*(~800 chars — the 4,000 limit is generous, but App Store release notes are
usually skimmed; this leads with the one genuinely new capability.)*

**Before publishing these notes, confirm each line still matches the build:**
BYOK is the only claim that describes data leaving the device, and it is the
reason the privacy policy and App Privacy answers had to be revisited (see
`app-store-submission.md` §1 and §8). Do not ship the BYOK bullet with a
privacy policy that does not mention third-party AI processing.

### v1.0 (shipped)
`First public release. Tell Xavier what you spent and it's tracked — privately, on your device. Encrypted storage, optional Face ID, receipt scanning, recurring transactions, and a month-summary widget that hides when your phone is locked.`

## Privacy one-liner (for the "Privacy" section / support page)
`Xavier collects no data. Everything you enter stays on your device, encrypted. Backups go only to your own iCloud. See our App Privacy details: Data Not Collected.`

## Notes for submission (not shown to users)
- Support URL + marketing URL are required fields — need a simple page/email.
- Age rating: likely 4+ (no objectionable content).
- Primary category: Finance. Secondary (optional): Productivity.
- Do NOT claim "bank-level encryption" or name specific algorithms in
  user-facing copy (keep marketing claims general; the technical detail lives in
  `app-store-submission.md`).
- "Apple Intelligence" / "on-device intelligence" wording: keep it descriptive
  ("on-device"), avoid implying an official Apple endorsement.

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

### v1.1 (current release — draft)

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

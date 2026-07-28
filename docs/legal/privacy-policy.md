# Privacy Policy — Xavier

**Effective date:** 28 July 2026
**Applies to:** Xavier for iOS (bundle identifier `com.projectxavier.app`), version 0.2.0 and later.

> **Draft for review — not legal advice.** This was prepared from the app's
> actual source code and is accurate to the best of our knowledge as of the
> effective date above. It has not been reviewed by a lawyer. Please read it
> yourself before publishing, and have it reviewed if your jurisdiction or
> distribution requires it. Replace the contact address before publishing.

---

## The short version

Xavier is a personal expense tracker that runs **entirely on your device**.

- We have **no server**, no accounts, and no sign-in. There is nothing for us to
  collect, and we collect nothing.
- We do **not** use analytics, advertising, tracking, or crash-reporting
  services of any kind.
- Your financial data stays on your iPhone, encrypted, unless you choose to back
  it up — and then it goes to **your own iCloud**, not to us.
- One optional feature ("Bring your own key") sends some of your data to an AI
  provider **you** choose, using **your** account with them. It is switched off
  unless you turn it on. Section 6 explains exactly what is sent.

We never see your finances. Not because we promise not to look — because there
is no mechanism by which your data could reach us.

---

## 1. Who we are

Xavier is developed and published by the individual developer identified on the
app's App Store listing.

**Contact:** `[INSERT CONTACT EMAIL BEFORE PUBLISHING]`

---

## 2. Information we collect

**None.**

We operate no servers or backend services. The app contains no analytics SDK, no
advertising SDK, no attribution or tracking framework, and no crash-reporting
service. We do not ask for your name, email address, phone number, or date of
birth, and there is no account to create.

We do not collect, receive, store, sell, rent, or share any personal
information, financial information, device identifiers, location, or usage data.

---

## 3. Information stored on your device

The app stores the information you enter, so that it can show it back to you:

- Transactions (amounts, dates, notes)
- Accounts, payees, categories and budgets you create
- Your settings and preferences

This lives in a local database on your iPhone, **encrypted at rest** using
SQLCipher (AES). The encryption key is generated on your device and held in the
iOS **Keychain**; it never leaves your device and we never have access to it.

If you enable **Face ID / Touch ID** unlock, authentication is performed by iOS
itself. The app is told only whether authentication succeeded. Your biometric
data is never made available to the app, and is never transmitted anywhere.

---

## 4. Backups

Backups are optional and, when enabled, are written to **your own iCloud
Documents container** for this app, under your Apple ID.

- Backups do **not** pass through any system operated by us. We cannot read,
  access, or recover them.
- A backup file is a copy of your app database. It is protected by Apple's
  iCloud encryption, your Apple ID, and your device passcode, rather than by a
  separate password of its own.
- You can disable backups, and delete existing ones, from within iCloud and from
  the app's settings.

Your relationship with iCloud is governed by Apple's privacy policy and terms,
not by this one.

---

## 5. Camera, photos, and receipts

If you scan a receipt, the app requests access to your camera and/or photo
library. Text is extracted from the image **on your device**, using Apple's
built-in on-device Vision text recognition.

**Receipt images are never uploaded anywhere.** They are not sent to us, to any
AI provider, or to any third party. Only the text you confirm becomes part of a
transaction, and that stays on your device like any other entry.

You can decline or later revoke camera and photo permissions in iOS Settings;
the rest of the app continues to work.

---

## 6. The assistant, and the optional "Bring your own key" feature

### 6.1 By default: on-device only

Out of the box, Xavier's assistant runs on **Apple's on-device Foundation
Models**, built into iOS. Nothing you type into the assistant leaves your
iPhone. No network connection is used, and no key or account is required.

### 6.2 If you turn on "Bring your own key" (BYOK)

BYOK is **off by default**. You must go to Settings → Assistant, switch it on,
and paste an API key you obtained yourself from OpenAI or Anthropic. When it is
on, the app sends your assistant requests directly from your device to that
provider, using your key and your own billing relationship with them.

**Requests go straight from your iPhone to the provider. They never pass through
any infrastructure we operate — we operate none — and we receive no copy of
them.**

**What is sent to the provider you chose:**

- The text of the request you typed into the assistant.
- **The names of your accounts, payees, and categories**, so the assistant can
  match what you wrote against entries you already have. (For example, if you
  have a payee called "Kopitiam" and an account called "DBS Savings", those names
  are included.)
- Your device's current date and time.
- For questions that produce a summary or chart, figures the app has already
  calculated on your device to answer that specific question.
- The app's own instructions to the model.

**What is never sent:**

- Your database, in whole or in part, as a file. There is no bulk upload or sync.
- Receipt images or any other photo.
- Your backups.
- Any name, email address, or account credentials for Xavier — there are none.

**Your API key** is stored in the iOS Keychain on your device. It is sent only
to the provider it belongs to, in order to authorise your own requests. It is
never sent anywhere else and is never recorded in logs.

**The provider's terms govern what they do with what you send them**, including
how long they keep it and whether they use it to improve their models. That is a
relationship between you and them, under the account and key you supplied. We
are not a party to it and have no visibility into it. Please read the privacy
policy of whichever provider you use:

- OpenAI — <https://openai.com/policies/privacy-policy>
- Anthropic — <https://www.anthropic.com/legal/privacy>

**Turning it off:** switch BYOK off in Settings → Assistant, and delete the
stored key from the same screen. The assistant reverts to running entirely on
your device. Deleting the app removes the key from the Keychain along with your
data. Removing data already sent to a provider is done through your account with
that provider.

---

## 7. Diagnostics

The app contains a developer diagnostics feature used during development. It is
**disabled in the version distributed on the App Store**, records no content from
your data even when enabled, and has no upload path — diagnostic information can
only ever be exported by you, deliberately, via the iOS share sheet.

---

## 8. Children

Xavier is not directed at children and does not knowingly collect information
from anyone. Because the app collects no information at all and requires no
account, there is nothing for us to collect from a user of any age.

---

## 9. Your rights

Because we hold no data about you, there is nothing for us to disclose, correct,
export, or delete on your behalf, and no request you need to make to us to
exercise those rights.

You are always in direct control of your own data:

- **Export it** — create a backup from within the app.
- **Delete it** — delete the app, which removes its local database and its
  Keychain entries. Delete any backups from iCloud separately.
- **Stop all outbound data** — switch BYOK off, or leave it off.

---

## 10. Changes to this policy

If the app's data handling changes, this policy will be updated and the effective
date above revised. Material changes — in particular, any change to what leaves
your device — will be described in the App Store release notes for the version
that introduces them.

---

## 11. Contact

Questions about this policy: `[INSERT CONTACT EMAIL BEFORE PUBLISHING]`

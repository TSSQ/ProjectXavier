Feature: Account reference fragment extraction
  extractAccountReferenceFragment (docs/design/account-chat-crud-spec.md,
  QA MAJOR follow-up) strips the leading verb, determiners/possessives, and
  a trailing GENERIC "account"/"accounts" word from a full utterance, so a
  whole sentence ("delete my DBS account") reduces to the fragment
  findAccountMatch actually expects ("dbs"). A trailing SUBTYPE-SPECIFIC word
  ("wallet", "savings", "card") is never stripped — it's itself a valid
  subtype-cue fragment.

  Scenario Outline: Strips verb + determiners + a trailing generic "account"
    Then extracting the reference fragment from "<text>" should give "<fragment>"

    Examples:
      | text                                | fragment    |
      | delete my DBS account               | dbs         |
      | close my amex                       | amex        |
      | get rid of my wallet                | wallet      |
      | delete my checking account          | checking    |
      | rename my DBS Savings to Rainy Day  | dbs savings to rainy day |
      | remove my credit card               | credit card |
      | delete my wallet                    | wallet      |

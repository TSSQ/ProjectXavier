Feature: Deterministic account-creation intent gate
  detectAccountIntent (docs/design/account-chat-creation-spec.md §5.1) decides
  — without ever asking a model — whether a free-text utterance is "create a
  new account" (verb + noun, no amount/preposition between them) versus an
  ordinary expense/transfer that merely mentions an account-shaped word.

  Scenario Outline: The collision test set (spec §8 acceptance #1)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                       | result                    |
      | add a DBS savings account with 500         | hit with hint "bank"      |
      | make a wallet                              | hit with hint "cash"      |
      | open Amex card                             | hit with hint "credit_card" |
      | create a car loan account                  | hit with hint "loan"      |
      | set up a Fidelity investment account       | hit with hint "investment" |
      | add 500 to savings                         | miss                      |
      | move 200 into wallet                        | miss                      |
      | paid mum 50                                | miss                      |
      | lunch 18                                   | miss                      |
      | how much did I spend                       | miss                      |

  Scenario: A generic "account" noun hits with no subtype hint
    Then detecting account intent in "add account" should hit with no hint

  Scenario: "new account:" and "add account" lead-ins both hit
    Then detecting account intent in "new account: DBS" should hit with no hint
    And detecting account intent in "add account for my paycheck" should hit with no hint

  Scenario Outline: The government-rule collision set (QA follow-up on the "new" bypass + possessive leak)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                          | result                      |
      | add 20 to my new wallet                       | miss                        |
      | move 200 into my new wallet                   | miss                        |
      | add 50 to my new credit card                  | miss                        |
      | transfer 300 to my new investment account     | miss                        |
      | add a note to my account                      | miss                        |
      | add money to my account                       | miss                        |
      | I want to add a savings account                | hit with hint "bank"        |
      | start a savings account                        | hit with hint "bank"        |
      | start a brokerage account                      | hit with hint "investment"  |
      | new card game                                  | miss                        |
      | my new investment idea                         | miss                        |

  Scenario Outline: Bare "new" is anchored to the start of the utterance (QA follow-up — merely REFERENCING an existing "new X" must not hit)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                          | result                      |
      | thanks for the new wallet                     | miss                        |
      | I love my new wallet                          | miss                        |
      | lost my new wallet                            | miss                        |
      | she gave me a new wallet                      | miss                        |
      | found my new card                             | miss                        |
      | returning the new card                        | miss                        |
      | my new savings account is empty               | miss                        |
      | I hate my new bank account                    | miss                        |
      | review of my new investment account           | miss                        |
      | my new loan account has high interest         | miss                        |
      | new wallet                                     | hit with hint "cash"        |
      | new card                                       | hit with hint "credit_card" |
      | new savings account                            | hit with hint "bank"        |
      | new account: Trust Bank, 3.2k                  | hit with no hint            |
      | make a new savings account                     | hit with hint "bank"        |
      | set up a new wallet                            | hit with hint "cash"        |
      | I want to create a wallet                      | hit with hint "cash"        |

  Scenario Outline: The forward guard applies to EVERY creation verb, not just bare "new" (reviewer follow-up — attributive noun use must not hijack an expense)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                    | result                      |
      | make a credit card payment 200          | miss                        |
      | make a loan payment                     | miss                        |
      | add a credit card payment 200           | miss                        |
      | add a loan payment 500                  | miss                        |
      | make a mortgage payment 1200            | miss                        |
      | open a savings goal                     | miss                        |
      | open a credit card statement            | miss                        |
      | i want to make a credit card payment    | miss                        |
      | open a credit card                      | hit with hint "credit_card" |
      | open a savings account                  | hit with hint "bank"        |
      | open a credit card with 500             | hit with hint "credit_card" |

  Scenario Outline: "named"/"called"/"ending" introduce the account's own name/description, not a different head noun (reviewer recall follow-up)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                    | result                      |
      | open a wallet named travel               | hit with hint "cash"        |
      | open a credit card ending 1234           | hit with hint "credit_card" |
      | open a wallet called travel              | hit with hint "cash"        |

  Scenario Outline: "at"/"in"/"of" are deliberately NOT added as allowed trailing words — accepted MISS (reviewer follow-up)
    # These connectors carry real re-open risk ("add a card AT starbucks" is
    # an expense, not creation) — safer to fall through to "please rephrase"
    # than risk a money-hijack false positive. Do NOT "fix" these into HITs.
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                    | result                      |
      | open a brokerage at Fidelity            | miss                        |
      | set up an investment in stocks          | miss                        |
      | create a wallet in USD                  | miss                        |

Feature: Account intent op-discrimination (create vs update vs delete vs expense)
  detectAccountIntent (docs/design/account-chat-crud-spec.md §4) now returns
  `{ op, subtypeHint }` on a hit — the model never decides `op`; only this
  pure, deterministic gate does. The noun-side rules (government, attributive/
  trailing guard) are unchanged and shared by every op.

  Scenario Outline: The op-discrimination collision set (spec §8 acceptance #2)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                          | result                    |
      | add a wallet                                  | create with hint "cash"   |
      | add a DBS savings account with 500            | create with hint "bank"   |
      | rename my wallet                               | update with hint "cash"   |
      | rename my DBS account to Rainy Day             | update with no hint       |
      | change my wallet to a credit card              | update with hint "cash"   |
      | update my OCBC account                         | update with no hint       |
      | edit my savings account                        | update with hint "bank"   |
      | rebalance my wallet                             | update with hint "cash"   |
      | delete my DBS account                          | delete with no hint       |
      | delete my wallet                                | delete with hint "cash"   |
      | remove my credit card                           | delete with hint "credit_card" |
      | close my account                                | delete with no hint       |
      | get rid of my wallet                            | delete with hint "cash"   |
      | remove 50 from savings                          | miss                      |
      | close the app                                   | miss                      |
      | paid mum 50                                     | miss                      |
      | lunch 18                                        | miss                      |
      | wallet 50                                       | miss                      |
      | make a wallet                                   | create with hint "cash"   |
      | make my cash wallet a bank account               | update with no hint       |
      | change the card to Amex Platinum                 | update with hint "credit_card" |
      | make a new savings account                       | create with hint "bank"   |

  Scenario: "set up" (create) is not mistaken for an update via bare "set"
    Then detecting account intent in "set up a wallet" should create with hint "cash"

  Scenario Outline: An account noun mentioned in an unrelated clause is NOT the op's target (QA MAJOR follow-up)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                                | result |
      | change my mind about the wallet                     | miss   |
      | remove the notification about my credit card        | miss   |
      | update my thinking about the account                | miss   |
      | delete the reminder regarding my account              | miss   |
      | remove 50 from savings                               | miss   |
      | get rid of my wallet                                 | delete with hint "cash" |

  Scenario Outline: "on" is NOT a clause preposition (QA recall-regression follow-up — "on" means "belonging to" as often as "regarding", and the latter is the REAL target)
    Then detecting account intent in "<text>" should <result>

    Examples:
      | text                                                | result |
      | change the balance on my savings                    | update with hint "bank" |
      | update the balance on my card                       | update with hint "credit_card" |
      | change my card on file to Amex                      | update with hint "credit_card" |
      | rebalance the balance on my loan                    | update with hint "loan" |

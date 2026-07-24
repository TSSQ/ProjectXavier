Feature: Deterministic account target-matcher (findAccountMatch)
  findAccountMatch (docs/design/account-chat-crud-spec.md §5.1) resolves a
  free-text account reference to a real account row — mirroring
  findPayeeMatch/findCategoryMatch (exact -> case-insensitive -> token/
  substring -> fuzzy), plus resolving by SUBTYPE CUE ("the card", "my
  savings") so semantic references the user never typed verbatim still
  resolve without a model. Known accounts throughout: DBS Savings (bank),
  OCBC Current (bank), Cash Wallet (cash), Amex (credit_card).

  Scenario Outline: Resolution ladder — exact, case-insensitive, token/substring, subtype cue
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for "<text>"
    Then the matched account should be "<account>"

    Examples:
      | text            | account     |
      | DBS Savings     | DBS Savings |
      | dbs savings     | DBS Savings |
      | DBS              | DBS Savings |
      | Amex             | Amex        |
      | my amex          | Amex        |
      | wallet           | Cash Wallet |
      | the card         | Amex        |
      | my current account | OCBC Current |
      | my savings       | DBS Savings |

  Scenario: A fuzzy near-miss is offered as a suggestion, not auto-resolved
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for "OCBC Curent"
    Then the match should suggest "OCBC Current"
    And the match should not resolve an account

  Scenario: Two accounts of the same subtype with no distinguishing cue word are ambiguous
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for "my checking account"
    Then the match should be ambiguous

  Scenario: No match at all returns null
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for "Fidelity Brokerage"
    Then there should be no match at all

  Scenario: A shared CATEGORY cue word ("card") is never a valid disambiguator between two same-subtype accounts (QA MAJOR follow-up)
    Given the known credit-card accounts Amex and Chase Card
    When I find an account match for "the card"
    Then the match should be ambiguous

  Scenario Outline: A full chat DELETE sentence resolves the real target, not just a pre-extracted fragment (QA MAJOR follow-up — the exact runtime pipeline: extractAccountReferenceFragment then findAccountMatch)
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for the delete sentence "<text>"
    Then the matched account should be "<account>"

    Examples:
      | text                          | account     |
      | delete my DBS account         | DBS Savings |
      | close my amex                 | Amex        |
      | get rid of my wallet          | Cash Wallet |

  Scenario: An ambiguous full DELETE sentence still asks "which account?" (QA MAJOR follow-up)
    Given the known accounts DBS Savings, OCBC Current, Cash Wallet, Amex
    When I find an account match for the delete sentence "delete my checking account"
    Then the match should be ambiguous

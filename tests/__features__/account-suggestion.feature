Feature: "Did you mean SG Pools?" — account suggestions, like payee's
  Typing "sg pool 20" used to file the expense silently on the default
  account. The model often did name "SG Pools", but the grounding guard
  (applyGroundingGuards) drops any account the user didn't type verbatim —
  correctly, because the same guard is what stops a past payee or a
  hallucinated account from being filed as fact. So the fix is not a prompt:
  interpret() looks for a near-miss of a real account in the user's own words
  (findAccountMentionInText) and OFFERS it. The draft stays on the default
  account until the user taps "Use SG Pools"; "Keep UOB One" dismisses it.
  Known accounts throughout: UOB One (SGD, the default), SG Pools (SGD),
  Cash (SGD), Travel Card (USD).

  Scenario Outline: A near-miss of a real account name in the text is found
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I look for an account mentioned in "<text>"
    Then the mentioned account should be "<account>"

    Examples:
      | text             | account     |
      | sg pool 20       | SG Pools    |
      | SG POOLS 20      | SG Pools    |
      | paid cash 4      | Cash        |
      | travel crad 50   | Travel Card |

  Scenario Outline: Words that merely resemble an account are not a mention
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I look for an account mentioned in "<text>"
    Then no account should be mentioned

    Examples:
      | text             |
      | car wash 12      |
      | spent 20 at pool |
      | lunch 12         |

  Scenario: The guard drops the model's correct "SG Pools" because the user typed "sg pool"
    When the model names account "SG Pools" for "sg pool 20"
    Then the grounded parse should have no account

  Scenario Outline: interpret() offers the account whatever the model said
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "sg pool 20" with the model's account <model account>
    Then the draft should stay on "UOB One"
    And the draft should suggest "SG Pools"

    Examples:
      | model account |
      | "SG Pools"    |
      | "sg pool"     |
      | none          |

  Scenario: An exact account name resolves directly — nothing to suggest
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "sg pools 20" with the model's account "SG Pools"
    Then the draft should stay on "SG Pools"
    And the draft should not suggest an account

  Scenario: A near-miss of the account the draft is already on is not offered back
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "uob onee 12" with the model's account none
    Then the draft should stay on "UOB One"
    And the draft should not suggest an account

  Scenario: Using the suggestion moves the draft and clears "not found"
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "sg pool 20" with the model's account "sg pool"
    And I use the account suggestion
    Then the draft should stay on "SG Pools"
    And the draft account should not be defaulted
    And the draft should have no unmatched account name
    And the draft should not suggest an account

  Scenario: Keeping the account dismisses the suggestion and changes nothing else
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "sg pool 20" with the model's account "sg pool"
    And I keep the account
    Then the draft should stay on "UOB One"
    And the draft account should be defaulted
    And the draft should not suggest an account

  Scenario: Using a suggestion in another currency asks, never converts
    Given the known accounts UOB One, SG Pools, Cash, Travel Card
    When I interpret "travel crad 50 SGD" with the model's account none
    And I use the account suggestion
    Then the draft should stay on "Travel Card"
    And the draft should flag the currency "SGD" as mismatched

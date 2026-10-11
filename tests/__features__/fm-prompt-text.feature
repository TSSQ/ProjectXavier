Feature: The model never sees the date phrase code reads itself
  Code reads the date from the user's own words (resolveTypedDate) and
  overrides the model's, the same way it reads the amount. So the phrase is
  removed from the text handed to the on-device and the cloud model
  (fmPromptText, src/domain/deviceParsePrompt.ts): a day word was the
  model's commonest reason to refuse a real log ("movie 20 on monday", "taxi
  18 tomorrow"). The date, the cue check and the grounding guards still read
  the ORIGINAL text. "Now" is Thursday 16 Jul 2026, 12:00.

  Scenario Outline: The date phrase is removed from the model's text
    Then the model's text for "<text>" is "<prompt>"

    Examples:
      | text                     | prompt               |
      | movie 20 on monday       | movie 20             |
      | 30 petrol last fri       | 30 petrol            |
      | coffee 4.5 ytd           | coffee 4.5           |
      | 2$ on drinks today       | 2$ on drinks         |
      | taxi 18 tomorrow         | taxi 18              |
      | lunch 12 yesterday       | lunch 12             |
      | dinner 2 days ago 30     | dinner 30            |
      | spent 30 on 24/06/2026   | spent 30             |
      | rent 1500 on the 1st     | rent 1500            |
      | lunch yesterday, 12      | lunch, 12            |

  Scenario Outline: Text with no date phrase, or nothing left without it, is unchanged
    Then the model's text for "<text>" is "<text>"

    Examples:
      | text                 |
      | coffee 4.80          |
      | Sunday Folks 12      |
      | grab tuesday 8       |
      | yesterday            |
      | TGI Fridays 45       |
      | paying the 300 deposit tomorrow |
      | will pay 50 tomorrow |

  Scenario Outline: The span the date resolvers read is reported without changing their reading
    Then the date span of "<text>" is "<span>"

    Examples:
      | text                         | span          |
      | movie 20 on monday           | on monday     |
      | lunch 12 day before yesterday | day before yesterday |
      | spent 30 on 24/06/2026       | on 24/06/2026 |
      | paid 20 on 23 sept           | on 23 sept    |
      | snack 4 tomorrow             | tomorrow      |
      | coffee 4.80                  |               |

  Scenario: The pipeline still dates and grounds from the original text
    Given the model logs "lunch at Subway 12 yesterday" with payee "Subway"
    When the FM parse is finished
    Then the parse is dated 2026-07-15 with payee "Subway"

Feature: The on-device parse retries only when the text names an amount
  A parse is useful only with an amount. When the words name none, a second
  Foundation Models generation can only invent one, so it is skipped
  (issue #27 — one message could cost 2–4 generations).

  Scenario Outline: Text that names an amount keeps the retry
    Then "<text>" should have amount evidence

    Examples:
      | text                        |
      | coffee 4.80                 |
      | lunch $12 at maxwell        |
      | grab five dollars           |
      | paid Twenty for parking     |
      | a dozen eggs                |
      | two grand for the laptop    |
      | a fiver at the market       |
      | ₹500 groceries              |
      | コーヒー５００円            |
      | قهوة ٥٠                     |

  Scenario Outline: Text with no amount skips it
    Then "<text>" should have no amount evidence

    Examples:
      | text                        |
      | coffee at starbucks         |
      | lunch with the team         |
      | someone paid me back        |
      | often at the gym            |
      | bought a phone case         |

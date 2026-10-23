Feature: Code reads who gave money to whom, and what for, before the model runs
  The sign reader sees words, not roles: "Brother returned me 6.9 for mcd" and
  "got 30 from dad for taxi" were read as expenses on "for", overriding the
  model's own answer. The slot reader (src/domain/slotReader.ts) reads the
  sentence's structure with the amount and the date masked: subject, verb,
  object, "from"/"to" a person, and the "for"/"on" purpose. It decides the
  type where the structure says it, names the payee from the person slot
  (resolved against the user's own payees, src/domain/slotPayee.ts), and
  stands aside wherever the words do not say.

  Scenario Outline: Someone gave, sent, paid, returned or lent the user money
    Then the slots read from "<text>" are "to_me", person "<person>", purpose "<purpose>"

    Examples:
      | text                                 | person    | purpose        |
      | Brother returned me 6.9 for mcd      | Brother   | mcd            |
      | bro returned me 12 for lunch         | bro       | lunch          |
      | mum gave me 50                       | mum       | none           |
      | sis paid me back 20                  | sis       | none           |
      | sis paid me back 15 for movie tickets | sis      | movie tickets  |
      | Priya transferred me 45 for dinner   | Priya     | dinner         |
      | uncle lent me 300                    | uncle     | none           |
      | ah ma gave me 50                     | ah ma     | none           |
      | Uncle Tan gave me 20                 | Uncle Tan | none           |
      | my sister sent me 70                 | sister    | none           |
      | Mum Gave Me 50                       | Mum       | none           |
      | hubby paid me back 35 yesterday      | hubby     | none           |
      | Priya sent 50 to me for the tickets  | Priya     | the tickets    |
      | returned me 8 for kopi               | none      | kopi           |
      | work paid me 300                     | none      | none           |

  Scenario Outline: The user got, received or borrowed money from someone
    Then the slots read from "<text>" are "to_me", person "<person>", purpose "<purpose>"

    Examples:
      | text                                         | person | purpose            |
      | got 30 from dad for taxi                     | dad    | taxi               |
      | got back 25 from bf for lunch                | bf     | lunch              |
      | received 100 from Priya for the concert tickets | Priya | the concert tickets |
      | received 2000 salary from Acme               | Acme   | none               |
      | got 15 cashback from Shopee                  | Shopee | none               |
      | borrowed 100 from dad                        | dad    | none               |

  Scenario Outline: The user gave, sent, paid, returned or lent someone money
    Then the slots read from "<text>" are "from_me", person "<person>", purpose "<purpose>"

    Examples:
      | text                                 | person  | purpose      |
      | I gave bro 20 for lunch              | bro     | lunch        |
      | gave mum 300 for the household       | mum     | the household |
      | paid sis 25 for dinner yesterday     | sis     | dinner       |
      | returned 20 to bro                   | bro     | none         |
      | paid back Priya 60                   | Priya   | none         |
      | paid uncle back 40                   | uncle   | none         |
      | lent sis 50                          | sis     | none         |
      | sent mum $100 on her birthday        | mum     | her birthday |
      | transferred 150 to hubby             | hubby   | none         |
      | gave auntie 50 for ang bao           | auntie  | ang bao      |
      | paid Grab 8 for the ride             | Grab    | the ride     |
      | paid Ah Ma 100                       | Ah Ma   | none         |
      | sis borrowed 50 from me              | sis     | none         |

  Scenario Outline: Where the structure does not say who gave to whom, the reader stands aside
    Then the slots read from "<text>" have no direction

    Examples:
      | text                             |
      | Sam paid 40 for dinner           |
      | mum paid sis 20                  |
      | mum gave me 50 and I gave sis 20 |
      | I owe dad 50                     |
      | bro owes me 20                   |
      | Toys for Tots donation 50        |
      | dinner for 4 120                 |
      | returned shoes +59               |
      | paid 500 to credit card          |
      | transferred 500 to savings       |
      | got 50 from ATM                  |
      | got paid 300                     |
      | paid GST 5                       |
      | paid Citi Card bill 500          |
      | transferred 500 to OCBC          |
      | coffee 4.80                      |

  Scenario: The user's own accounts are never the person
    Given the user's accounts are "DBS Savings, Cash"
    Then the slots read from "transferred 500 to DBS Savings" have no direction
    And the slots read from "transferred 80 to Priya" are "from_me", person "Priya", purpose "none"

  Scenario: A lowercase word is a person when it is one of the user's payees
    Given the user's payees are "Priya, Grab"
    Then the slots read from "paid priya 20 for lunch" are "from_me", person "priya", purpose "lunch"
    And the slots read from "paid jane 20 for lunch" have no direction

  Scenario Outline: The sign reader lets who gave to whom decide over "for"
    Then the sign read from "<text>" is "<type>" by the slot reader

    Examples:
      | text                            | type    |
      | Brother returned me 6.9 for mcd | income  |
      | got 30 from dad for taxi        | income  |
      | colleague returned me 8 for kopi | income |
      | borrowed 100 from dad           | income  |
      | I gave bro 20 for lunch         | expense |
      | lent sis 50                     | expense |
      | gave auntie 50 for ang bao      | expense |
      | transferred 150 to mum          | expense |

  Scenario Outline: "for" is a purpose, not a spend, when money moved between the user and someone
    Then the sign read from "<text>" is "income"

    Examples:
      | text                        |
      | got 30 from jane for taxi   |
      | jane returned me 8 for kopi |

  Scenario: A strong word outside the deciding clause is a competing reading
    Then the sign read from "mum paid me back 20, I paid 50 for dinner" is undecided

  Scenario Outline: The person resolves through the user's own payees, else stays the user's word
    Given the user's payees are "Brother, Mum, Sister, Uncle Tan, Grab"
    Then the person "<person>" resolves to payee "<payee>" by "<how>"

    Examples:
      | person | payee     | how   |
      | Mum    | Mum       | exact |
      | grab   | Grab      | exact |
      | bro    | Brother   | fuzzy |
      | sis    | Sister    | fuzzy |
      | mom    | Mum       | exact |
      | uncle  | Uncle Tan | fuzzy |
      | bf     | bf        | new   |
      | Priya  | Priya     | new   |

  Scenario: A payee the user taught on the Ask card is remembered for the person
    Given the user's payees are "Mei Ling, Grab"
    And phrase memory remembers payee "Mei Ling" for the word "bestie"
    Then the person "bestie" resolves to payee "Mei Ling" by "memory"

  Scenario Outline: The finished parse takes its type and payee from the slots
    Given the user's payees are "Brother, Mum, Priya, Dad, Sister, Grab"
    And the user's accounts are "DBS Savings, Cash"
    And the model answered type "<model type>" and payee "<model payee>" for "<text>"
    When the parse is finished
    Then the finished type is "<type>" and payee "<payee>", slot fields "<slots>"

    Examples:
      | text                            | model type | model payee | type    | payee   | slots        |
      | bro returned me 12 for lunch    | expense    | Brother     | income  | Brother | type, payee  |
      | got 30 from dad for taxi        | expense    | taxi        | income  | Dad     | type, payee  |
      | paid sis 25 for dinner          | expense    | sis         | expense | Sister  | payee        |
      | paid Grab 8 for the ride        | expense    | Grab        | expense | Grab    | none         |
      | mum gave me 50                  | income     | Mum         | income  | Mum     | none         |
      | transferred 80 to Priya         | transfer   | none        | expense | Priya   | type, payee  |
      | Sam paid 40 for dinner          | income     | Sam         | income  | Sam     | none         |
      | received 100 from Priya for the concert | income | concert | income | Priya  | payee        |

  Scenario Outline: The heuristic floor reads the same slots
    Given the user's payees are "Brother, Mum, Grab"
    When I locally parse "<text>" with those payees
    Then the heuristic gives type "<type>" and payee "<payee>"

    Examples:
      | text                         | type    | payee   |
      | bro returned me 12 for lunch | income  | Brother |
      | got 30 from dad for taxi     | income  | dad     |
      | paid Grab 8 for the ride     | expense | Grab    |
      | I gave bro 20 for lunch      | expense | Brother |
      | lent sis 50                  | expense | sis     |
      | groceries 40 at FairPrice    | expense | FairPrice |

  Scenario: The slot fields are named on the correction capture
    Given a draft whose type and payee the slot reader set
    Then its applied defaults are "slot:type, slot:payee"

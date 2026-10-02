Feature: Reading the amount candidates out of a text, deterministically
  The on-device model is unreliable at copying a number out of a sentence, so
  code reads the amounts first (src/domain/amountCandidates.ts) and the model
  only chooses among what was found. A number that is a date, a time, a
  percentage, a card suffix, a phone number, an id or a count is not an amount.

  Scenario Outline: Amounts in the usual written forms
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values  |
      | coffee 4.80                         | 4.8     |
      | paid $1,250 for rent                | 1250    |
      | €1.234,56 groceries                 | 1234.56 |
      | petrol 1.050,00 EUR                 | 1050    |
      | paid 12,50 for lunch                | 12.5    |
      | petrol 1 250                        | 1250,1,250 |
      | got paid 3k                         | 3000    |
      | conference fee 1.2k                 | 1200    |
      | 15 bucks for lunch                  | 15      |
      | +3200 payday                        | 3200    |
      | S$5 kopi                            | 5       |
      | RM50 nasi lemak                     | 50      |
      | USD 20 tip                          | 20      |
      | 20 SGD for the cab                  | 20      |
      | コーヒー５００円                          | 500     |
      | قهوة ٥٠                             | 50      |
      | 50 cents for the gumball            | 0.5     |
      | 5 hundred for rent                  | 500     |

  Scenario Outline: Spelled-out amounts are read only with a currency word
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | spent twenty dollars on gas         | 20     |
      | one hundred and fifty bucks for amp | 150    |
      | a fiver at the market               | 5      |
      | two grand for the laptop            | 2000   |
      | grab five                           | none   |
      | paid Twenty for parking             | none   |
      | a dozen eggs                        | none   |

  Scenario Outline: Numbers that are not amounts
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | remind me at 5pm                    | none   |
      | the meeting is at 9:30              | none   |
      | call 555-123-4567                   | none   |
      | my number is +65 9123 4567          | none   |
      | the card ending 4008                | none   |
      | visa -4008                          | none   |
      | chase-4008                          | none   |
      | 15% off                             | none   |
      | meet on 12/03                       | none   |
      | meet on June 24                     | none   |
      | due on the 5th                      | none   |
      | 1st place                           | none   |
      | set a timer for 10 minutes          | none   |
      | split with 3 friends                | none   |
      | order #1234                         | none   |
      | x2                                  | none   |
      | back in 2024                        | none   |
      | lunch at chipotle                   | none   |

  Scenario Outline: A non-amount number next to a real amount does not hide it
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | paid 45 on 1/7                      | 45     |
      | June 24 paid 80 for shopping        | 80     |
      | dinner 90 with 3 friends            | 90     |
      | the card ending 4008 coffee 4       | 4      |
      | 15% tip on 80                       | 80     |
      | call 555-123-4567 and pay 20        | 20     |
      | lunch 12 at 5pm                     | 12     |
      | taxi 10 2 weeks ago                 | 10     |
      | rent 1500 on the 1st                | 1500   |

  Scenario Outline: A count or label before a real amount is dropped, but kept when it is all there is
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | bus 17 1.89                         | 1.89   |
      | table for 4 dinner 86               | 86     |
      | room 204 please                     | 204    |
      | bus 17                              | 17     |

  Scenario Outline: Several plausible amounts are all returned, in reading order, once each
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | 2 coffees 9.60                      | 2,9.6  |
      | paid 45 and then 9.60 for lunch     | 45,9.6 |
      | lunch 12 12                         | 12     |
      | paid $5 $10                         | 5,10   |

  Scenario Outline: A number marked as money wins over bare numbers
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                                | values |
      | $45 for 3 nights, tip 5             | 45     |
      | 12 beers, paid 80 bucks             | 80     |
      | $200 ang bao from grandma, 2 aunties | 200    |

  Scenario Outline: Fractions of a unit and cents
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                     | values |
      | $.99 gum                 | 0.99   |
      | coffee .5                | 0.5    |
      | 3.5 coffee               | 3.5    |
      | 50¢ candy                | 0.5    |
      | 50c candy                | 0.5    |
      | 20 dollars and 50 cents  | 20.5   |
      | $20 and 50 cents         | 20.5   |
      | 150 cents for the gum    | 1.5    |

  Scenario Outline: A currency code after a number belongs to that number
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                     | values |
      | spent 50 USD 2 days ago  | 50     |
      | 20 SGD 3 nights          | 20     |
      | 20 SGD for 3 friends     | 20     |

  Scenario Outline: One dot and exactly three digits is ambiguous, so both readings are offered
    No decimal or thousands context settles it, so the model chooses from the
    closed set; a euro sign or an EU decimal elsewhere settles it as thousands.

    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                     | values    |
      | 5.000 coffee             | 5,5000    |
      | rent 1.250               | 1.25,1250 |
      | €1.250 rent              | 1250      |
      | rent 1.250 and tip 2,50  | 1250,2.5  |
      | 0.250 gum                | 0.25      |

  Scenario Outline: Names, periods and dates that are made of numbers
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                     | values |
      | 7-11 9                   | 9      |
      | 7-eleven 9               | 9      |
      | 20-30 lunch              | 20,30  |
      | Q3 2026 coffee 5         | 5      |
      | FY25 coffee 5            | 5      |
      | lunch 12 sept 5          | 5      |
      | paid 80 June 24          | 80     |
      | June 24 paid 80          | 80     |

  Scenario Outline: A letter prefix may carry a dot, and a bare leading dot is only a fraction
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                              | values |
      | Rs.500.00 debited from a/c XX1234 | 500 |
      | Rs.2,499 Amazon                   | 2499 |
      | Rp.50.000 parking                 | 50000 |
      | INR.500                           | 500 |
      | RM.50                             | 50 |
      | USD.20                            | 20 |
      | coffee .5                         | 0.5 |

  Scenario Outline: A space-grouped number counts as thousands only when it is anchored
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text               | values |
      | $1 250             | 1250 |
      | 1 250 SGD          | 1250 |
      | dinner for 4 120   | 4120,4,120 |
      | lunch 2 150        | 2150,2,150 |
      | split 3 200        | 3200,3,200 |
      | bought 3 450 total | 3450,3,450 |

  Scenario Outline: A sign is a weak hint: it never removes another number
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text                | values |
      | lunch 12 +2 tip     | 12,2 |
      | uber 25 (+3 tip)    | 25,3 |
      | coffee 5 -1 voucher | 5,1 |
      | taxi 30 -5 discount | 30,5 |
      | +3200 payday        | 3200 |

  Scenario Outline: A glued c is cents, but a label before it still counts
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text               | values |
      | 50c candy          | 0.5 |
      | apt 5c rent 1200   | 1200 |
      | seat 14c lunch 12  | 12 |
      | unit 3c parking 40 | 40 |

  Scenario Outline: Dollars and a bare two-digit number, fractions of a cent, years
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text               | values |
      | a dollar 50        | 1.5 |
      | coffee 3.14159     | none |
      | salary of 2000     | 2000 |
      | in 2026 coffee 5   | 5 |
      | since 2019 paid 40 | 40 |

  Scenario Outline: Quantity times price offers the product as one more reading
    Then the amount candidates of "<text>" are "<values>"

    Examples:
      | text           | values |
      | 2 tickets @ 15 | 2,30,15 |
      | 3 x 4.50       | 3,13.5,4.5 |
      | coffee 4 x     | 4 |

  Scenario: A very long text is read in linear time
    Then a 50000 character text is read in under 100 milliseconds

  Scenario Outline: Digits from other scripts are not read, so such a text goes to the model
    Then the amount candidates of "<text>" are "none"

    Examples:
      | text                     |
      | coffee ๕๐                |
      | coffee 五十              |
      | 咖啡 三十                 |

  Scenario: A candidate carries its span, its position and whether it was marked as money
    Then "$45 for lunch" yields the candidate span "$45" at 0 marked as money
    And "coffee 4" yields the candidate span "4" at 7 not marked as money

  Scenario: Every candidate validates against the schema and is positive and finite
    Then every candidate of the sample texts validates and is positive and finite

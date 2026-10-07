Feature: The chat feed's rows, tail and scrolling
  The feed draws what the log says, with the screen's own card in the live
  position and an unstored tail underneath
  (docs/design/xavier-daily-chat-spec.md sections 6.2 and 6.3).

  Scenario: Messages keep their order, each as its own kind of row
    Given a day with a user message, a Xavier message and a stubbed draft
    When the feed rows are built with no live card and no tail
    Then the rows should be "user, xavier, stub" in order

  Scenario: The stub row carries its wording
    Given a day with a user message, a Xavier message and a stubbed draft
    When the feed rows are built with no live card and no tail
    Then the stub row text should not be empty

  Scenario: A resolved non-query card draws nothing, a query answer stays as history
    Given a day with a resolved draft and a query answer
    When the feed rows are built with no live card and no tail
    Then the rows should be "answer" in order

  Scenario: The live row is the card the log holds, drawn once
    Given a day with a live draft followed by nothing
    When the feed rows are built with a live card and no tail
    Then the rows should be "live" in order

  Scenario: The live row sits at the newest end, after every stored row
    Given a day with a live queue followed by three receipts
    When the feed rows are built with a live card and no tail
    Then the rows should be "xavier, xavier, xavier, live" in order

  Scenario: A card the log never recorded still appears, at the end
    Given a day with a user message only
    When the feed rows are built with a live card and no tail
    Then the rows should be "user, live" in order

  Scenario: A log-live card the screen is not showing is its stub, never nothing
    Given a day with a live draft followed by nothing
    When the feed rows are built with no live card and no tail
    Then the rows should be "stub" in order

  Scenario: An active tail leaves a stored live card as its stub
    Given a day with a live draft followed by nothing
    When the feed rows are built with no live card and an active tail
    Then the rows should be "stub" in order

  Scenario: A query answer the screen is not showing stays as an answer
    Given a day with a live query answer, then the screen's card
    When the feed rows are built with no live card and no tail
    Then the rows should be "answer" in order

  Scenario: A tx picker on its which-account step stays the live row, never a stub
    Given a day with a live tx picker
    When the feed rows are built with a live card and no tail
    Then the rows should be "live" in order

  Scenario Outline: The layout phase reducer
    When the phase is <from> and the event is <event>
    Then the next phase should be <to>

    Examples:
      | from    | event                  | to      |
      | loading | loaded on an empty day | hero    |
      | loading | loaded with rows       | header  |
      | loading | notQuiet               | loading |
      | loading | moveFinished           | loading |
      | hero    | loaded on an empty day | hero    |
      | hero    | notQuiet               | moving  |
      | hero    | moveFinished           | hero    |
      | moving  | notQuiet               | moving  |
      | moving  | moveFinished           | header  |
      | header  | notQuiet               | header  |
      | header  | moveFinished           | header  |
      | header  | loaded with rows       | header  |

  Scenario Outline: A day reset goes back to the hero from any loaded phase
    When the phase is <from> and the event is dayReset
    Then the next phase should be hero

    Examples:
      | from   |
      | hero   |
      | moving |
      | header |

  Scenario: A day reset before the day has loaded changes nothing
    When the phase is loading and the event is dayReset
    Then the next phase should be loading

  Scenario: A reset while moving goes straight back to the hero
    Then a dayReset during the move lands on the hero and the move can start again

  Scenario: The move plays again after a reset even if the day is still not quiet
    Then a dayReset followed by the level-triggered notQuiet plays the move

  Scenario: The move can play again on the next day
    Then the phases run header, dayReset, hero, notQuiet, moving, moveFinished, header

  Scenario: A busy tail or a live card is not a quiet day
    Then a live card, a thinking tail and an unsent-but-cardless day are told apart

  Scenario: The transition's parts add up
    Then the greeting takes 200 ms, the move 450 ms, the header fade 200 ms and Reduce Motion 240 ms

  Scenario: The first look after the load is not an arrival
    Then the first look reports no event and no announcements, and the next look reports both

  Scenario: Every Xavier message in a batch is announced, whatever else arrived
    Then a user message with two Xavier messages announces both Xavier messages

  Scenario Outline: What the tail shows
    When the tail is computed for <situation>
    Then the tail should be <shown>

    Examples:
      | situation                                     | shown       |
      | nothing going on                              | inactive    |
      | parsing with no card                          | thinking    |
      | parsing with a card on screen                 | inactive    |
      | the account Q&A on its subtype step           | chips       |
      | the account Q&A on its name step              | progress    |
      | the FM refusal card                           | refusal     |
      | the no-budgets reply                          | budget hint |
      | an afford card reply                          | inactive    |

  Scenario Outline: Scroll decision
    When a <event> arrives while the user is <where>
    Then the feed should <action>

    Examples:
      | event    | where          | action        |
      | sent     | near the end   | scroll        |
      | sent     | scrolled up    | scroll        |
      | incoming | near the end   | scroll        |
      | incoming | scrolled up    | show the pill |

  Scenario: The pill leaves once the user is back at the bottom
    Then the pill should stay while scrolled up and go when near the bottom

  Scenario: Near the bottom is a distance threshold
    Then 20 points from the newest end with a threshold of 36 should be near the bottom
    And 200 points from the newest end with a threshold of 36 should not be near the bottom

  Scenario: A batch with a user message counts as sent
    Then an empty batch is nothing, a user and Xavier message together are sent, and Xavier alone is incoming

  Scenario: A user message and Xavier's reply added together scroll even when scrolled up
    Then a user message and a Xavier reply added together while scrolled up should scroll

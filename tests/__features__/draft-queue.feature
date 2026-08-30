Feature: Reviewing a batch of scanned drafts

  Scanning several receipts produces several drafts, confirmed one card at a
  time. The progress bar is shared with the parsing phase, which runs at
  roughly 2.4s per photo — long enough that a missing bar reads as a hang.

  Scenario: Progress through a batch
    Given a batch of 6
    When 3 are complete
    Then the label should be "3 of 6"
    And the fraction should be 0.5
    And it should not be done

  Scenario: A finished batch reports done
    Given a batch of 6
    When 6 are complete
    Then the label should be "6 of 6"
    And the fraction should be 1
    And it should be done

  Scenario: An empty batch is done with a full bar, not a stuck one
    Given a batch of 0
    When 0 are complete
    Then the fraction should be 1
    And it should be done

  Scenario: Over-counting cannot overflow the bar
    Given a batch of 3
    When 9 are complete
    Then the label should be "3 of 3"
    And the fraction should be 1

  Scenario: Deciding a card advances to the next
    Given a queue of 3 drafts
    When I save the current card
    Then the queue should be on card 2
    And the queue should not be done

  Scenario: Deciding the last card finishes the queue
    Given a queue of 2 drafts
    When I save the current card
    And I skip the current card
    Then the queue should be done
    And there should be no current draft
    And the summary should be 1 saved and 1 skipped

  Scenario: A double-tap on the last card cannot run past the end
    Given a queue of 1 drafts
    When I save the current card
    And I save the current card
    Then the queue should be done
    And the summary should be 1 saved and 0 skipped

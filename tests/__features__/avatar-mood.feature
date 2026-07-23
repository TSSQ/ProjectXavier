Feature: Assistant avatar mood
  The avatar's expression reflects what the assistant is doing.

  Scenario: A request in flight makes it think (even while typing)
    Given the assistant is busy and the user is typing
    Then the avatar state should be "thinking"

  Scenario: A saved entry makes it happy
    Given the assistant just saved an entry
    Then the avatar state should be "happy"

  Scenario: Saving an expense makes it angry
    Given the assistant just saved an expense
    Then the avatar state should be "angry"

  Scenario: Saving an expense while busy still thinks (busy wins)
    Given the assistant is saving an expense while busy
    Then the avatar state should be "thinking"

  Scenario: An error makes it confused
    Given the assistant hit an error
    Then the avatar state should be "confused"

  Scenario: A clarify outcome makes it confused
    Given the assistant asked a clarifying question
    Then the avatar state should be "confused"

  Scenario: Typing a retry supersedes a lingering error reaction
    Given the user starts typing after an error
    Then the avatar state should be "listening"

  Scenario: Typing an answer supersedes a clarify reaction
    Given the user starts typing after a clarify prompt
    Then the avatar state should be "listening"

  Scenario: Typing makes it listen
    Given the user is typing and nothing else is happening
    Then the avatar state should be "listening"

  Scenario: At rest it is idle
    Given nothing is happening
    Then the avatar state should be "idle"

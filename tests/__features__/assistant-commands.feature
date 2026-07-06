Feature: Assistant slash-command menu
  The pure command catalogue behind the "/" popover on the assistant home
  screen: filtering commands as the user types, and deciding when the menu
  should be showing at all.

  Scenario: A bare "/" lists every command
    When I match commands for "/"
    Then the matched commands are "/account, /transactions"

  Scenario: "/a" filters to "/account" only
    When I match commands for "/a"
    Then the matched commands are "/account"

  Scenario: "/t" filters to "/transactions" only
    When I match commands for "/t"
    Then the matched commands are "/transactions"

  Scenario: "/x" matches nothing
    When I match commands for "/x"
    Then the matched commands are ""

  Scenario: Matching is case-insensitive
    When I match commands for "/ACC"
    Then the matched commands are "/account"

  Scenario: An empty query lists every command too
    When I match commands for ""
    Then the matched commands are "/account, /transactions"

  Scenario: A bare "/" should open the menu
    Then "/" is a slash query
    And "/a" is a slash query
    And "/account" is a slash query

  Scenario: Text with no leading slash should not open the menu
    Then "" is not a slash query
    And "spent 10 at the shop" is not a slash query

  Scenario: A completed command followed by a space should close the menu
    Then "/account " is not a slash query
    And "/transactions lunch 10" is not a slash query

  Scenario: Leading whitespace doesn't change whether it's a slash query
    Then " /account" is a slash query
    And matching commands for " /account" also finds "/account"

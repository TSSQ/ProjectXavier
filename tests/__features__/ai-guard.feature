Feature: AI parse proxy abuse & cost controls
  The parse proxy enforces a per-user daily quota, a per-IP rate limit, and a
  response cache before ever calling the (paid) model. These keep a single user
  or a leaked account from running up the bill, and let identical inputs reuse a
  prior parse for free.

  Scenario: A user may parse up to their daily quota
    Given a daily quota of 3 parses
    When user "u1" makes 3 parse requests in one day
    Then all 3 requests should be allowed

  Scenario: The daily quota blocks the next request once exhausted
    Given a daily quota of 3 parses
    When user "u1" makes 3 parse requests in one day
    And user "u1" makes 1 more parse request
    Then that request should be blocked
    And the block should report a reset within 24 hours

  Scenario: The daily quota resets the next day
    Given a daily quota of 3 parses
    When user "u1" makes 3 parse requests in one day
    And a new day begins
    And user "u1" makes 1 more parse request
    Then that request should be allowed

  Scenario: Quotas are tracked per user
    Given a daily quota of 3 parses
    When user "u1" makes 3 parse requests in one day
    And user "u2" makes 1 parse request
    Then user "u2"'s request should be allowed

  Scenario: The per-IP rate limit blocks a burst within the window
    Given a rate limit of 2 requests per 60 seconds
    When IP "1.2.3.4" makes 3 requests within the window
    Then the first 2 should be allowed and the 3rd blocked

  Scenario: Identical inputs share a cache key, different context does not
    When I build cache keys for the same text with different default currencies
    Then the two cache keys should differ
    And reordering the known categories should not change the cache key

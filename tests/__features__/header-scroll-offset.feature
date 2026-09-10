Feature: Header scroll offset — hide-on-scroll-down, reveal-on-scroll-up

  The pure arithmetic behind ScreenHeader's slide-away-on-scroll behaviour
  (Dashboard and Transactions, transparent-hiding-header-spec.md). Given the
  header's current slide offset, the previous and new scroll positions and
  the header's own height, decide the new offset. 0 is fully shown,
  headerHeight is fully hidden. Framework-free — no Reanimated, no
  react-native — the component calls this from a plain JS-thread `onScroll`
  callback (not a `useAnimatedScrollHandler` worklet — see
  headerScrollOffset.ts's header comment for why) and writes the result into
  a shared value.

  Scenario: Scrolling down hides the header progressively
    Given a header offset of 0, headerHeight 60, scrolled from 60 to 90
    When the next header offset is computed
    Then the resulting offset should be 30

  Scenario: Scrolling down clamps at the header height
    Given a header offset of 50, headerHeight 60, scrolled from 100 to 200
    When the next header offset is computed
    Then the resulting offset should be 60

  Scenario: Scrolling up reveals the header progressively
    Given a header offset of 60, headerHeight 60, scrolled from 300 to 260
    When the next header offset is computed
    Then the resulting offset should be 20

  Scenario: Scrolling up clamps at zero
    Given a header offset of 20, headerHeight 60, scrolled from 100 to 40
    When the next header offset is computed
    Then the resulting offset should be 0

  # A list barely nudged near the top must not start hiding chrome the user
  # hasn't actually scrolled past — and a header that was ALREADY hidden
  # (e.g. from an earlier scroll session, restored scroll position) must snap
  # back rather than stay stuck hidden near the top.
  Scenario: Anywhere near the top forces the header fully shown, even mid-hide
    Given a header offset of 60, headerHeight 60, scrolled from 300 to 10
    When the next header offset is computed
    Then the resulting offset should be 0

  # The rubber-band bounce past the top of the list (a fast upward fling can
  # overshoot y past 0) must never read as "scrolled down" no matter how big
  # the previous position was.
  Scenario: A negative scroll position never hides the header
    Given a header offset of 60, headerHeight 60, scrolled from 500 to -10
    When the next header offset is computed
    Then the resulting offset should be 0

  # Transactions' open search field renders through ScreenHeader's `below`
  # prop. Sliding a focused text field off screen mid-typing is a genuine
  # bug, not a nicety — the header must never hide while it's present.
  Scenario: An open search field keeps the header fully shown while scrolling down
    Given a header offset of 0, headerHeight 60, scrolled from 0 to 500, with the search field open
    When the next header offset is computed
    Then the resulting offset should be 0

  Scenario: An open search field reveals an already-hidden header
    Given a header offset of 60, headerHeight 60, scrolled from 500 to 520, with the search field open
    When the next header offset is computed
    Then the resulting offset should be 0

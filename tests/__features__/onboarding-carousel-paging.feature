Feature: Welcome carousel paging math
  The build-39 welcome carousel (app/welcome.tsx) derives its page index and
  its "swipe past the end == Get Started" decision from these pure helpers
  (src/domain/onboardingCarousel.ts) rather than from per-scroll-frame state,
  so a not-yet-laid-out ScrollView (width === 0) can never divide-by-zero its
  way into snapping back to the first card or firing Get Started early.

  Scenario Outline: A resting offset maps to its page index
    Then the page index for offset <x> width <width> count <count> should be <index>

    Examples:
      | x   | width | count | index |
      | 0   | 100   | 4     | 0     |
      | 100 | 100   | 4     | 1     |
      | 200 | 100   | 4     | 2     |
      | 300 | 100   | 4     | 3     |

  Scenario: A negative offset clamps to the first page
    Then the page index for offset -50 width 100 count 4 should be 0

  Scenario: An offset past the last page clamps to the last page
    Then the page index for offset 9999 width 100 count 4 should be 3

  Scenario: A zero width (not yet laid out) never divides by zero
    Then the page index for offset 100 width 0 count 4 should be 0

  Scenario: A zero offset at zero width also stays on the first page
    Then the page index for offset 0 width 0 count 4 should be 0

  Scenario: A negative width (not a real layout measurement) never divides by zero either
    Then the page index for offset 100 width -100 count 4 should be 0

  Scenario: A non-positive card count has no page to land on
    Then the page index for offset 100 width 100 count 0 should be 0

  Scenario: A normal arrival at the last card does not trigger finish
    Then overscroll finish for offset 300 width 100 lastIndex 3 threshold 50 should be false

  Scenario: The bounce's own rubber-banding just past the last card does not trigger finish
    Then overscroll finish for offset 330 width 100 lastIndex 3 threshold 50 should be false

  Scenario: A deliberate extra swipe past the last card triggers finish
    Then overscroll finish for offset 360 width 100 lastIndex 3 threshold 50 should be true

  Scenario: Overscroll-finish never fires while width is 0 (not yet laid out)
    Then overscroll finish for offset 9999 width 0 lastIndex 3 threshold 50 should be false

  Scenario: Overscroll-finish never fires for a negative width either
    Then overscroll finish for offset 9999 width -100 lastIndex 3 threshold 50 should be false

  Scenario: Overscroll-finish never fires for a negative lastIndex (no last card to overscroll past)
    Then overscroll finish for offset 9999 width 100 lastIndex -1 threshold 50 should be false

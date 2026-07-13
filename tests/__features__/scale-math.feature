Feature: Responsive scale math
  The Assistant home and /account Q&A derive every size from
  `base × widthFactor × dynamicTypeFactor` (docs/design/responsive-scaling-spec.md)
  instead of hard-coded points, so large iPhones no longer read "zoomed out"
  and Dynamic Type is honored. This is the pure arithmetic behind that formula —
  framework-free so it's covered here rather than only visually on a simulator.

  Scenario Outline: Width factor scales with screen width and clamps to [0.94, 1.12]
    Then the width factor for screen width <width> should be <factor>

    Examples:
      | width | factor |
      | 320   | 0.94   |
      | 375   | 0.9615 |
      | 393   | 1.0077 |
      | 430   | 1.1026 |
      | 500   | 1.12   |

  Scenario Outline: Font scale clamps to [0.85, 1.60]
    Then the clamped font scale for raw font scale <raw> should be <scale>

    Examples:
      | raw  | scale |
      | 0.5  | 0.85  |
      | 0.85 | 0.85  |
      | 1    | 1     |
      | 1.6  | 1.6   |
      | 3    | 1.6   |

  Scenario Outline: Scaled size rounds base × widthFactor × fontScale for the role ramp
    Then the scaled size for base <base>, width factor <widthFactor>, font scale <fontScale> should be <size>

    Examples:
      | base | widthFactor | fontScale | size |
      | 22   | 0.96        | 1         | 21   |
      | 22   | 1.00        | 1         | 22   |
      | 22   | 1.10        | 1         | 24   |
      | 17   | 0.96        | 1         | 16   |
      | 17   | 1.00        | 1         | 17   |
      | 17   | 1.10        | 1         | 19   |
      | 16   | 1.10        | 1         | 18   |
      | 14   | 1.10        | 1         | 15   |
      | 16   | 1.10        | 1.60      | 28   |

  Scenario Outline: Width-tiered spacing/touch-target tables pick the right SE/15/Pro Max entry
    Then the <table> for screen width <width> should be <value>

    Examples:
      | table             | width | value |
      | avatar idle size  | 375   | 148   |
      | avatar idle size  | 393   | 160   |
      | avatar idle size  | 430   | 180   |
      | avatar flow size  | 375   | 104   |
      | avatar flow size  | 393   | 112   |
      | avatar flow size  | 430   | 124   |
      | quick chip height | 375   | 40    |
      | quick chip height | 393   | 42    |
      | quick chip height | 430   | 46    |
      | chip height       | 375   | 44    |
      | chip height       | 393   | 44    |
      | chip height       | 430   | 48    |
      | composer height   | 375   | 48    |
      | composer height   | 393   | 48    |
      | composer height   | 430   | 52    |
      | screen padding    | 375   | 24    |
      | screen padding    | 393   | 24    |
      | screen padding    | 430   | 28    |
      | dot size          | 375   | 8     |
      | dot size          | 393   | 8     |
      | dot size          | 430   | 10    |

  Scenario Outline: Width tier switches exactly at its breakpoints
    Then the width tier for screen width <width> should be <tier>

    Examples:
      | width | tier |
      | 383   | 0    |
      | 384   | 1    |
      | 411   | 1    |
      | 412   | 2    |

  Scenario Outline: Boundary widths land on the correct side of a width-tiered table
    Then the <table> for screen width <width> should be <value>

    Examples:
      | table            | width | value |
      | avatar idle size | 383   | 148   |
      | avatar idle size | 384   | 160   |
      | chip height      | 411   | 44    |
      | chip height      | 412   | 48    |

  Scenario Outline: Each type-ramp role has its documented base at the 390pt reference width
    Then the base for role <role> should be <base>

    Examples:
      | role           | base |
      | screenTitle    | 30   |
      | heroFigure     | 34   |
      | prompt         | 22   |
      | sectionHeading | 22   |
      | body           | 17   |
      | control        | 16   |
      | rowLabel       | 15   |
      | caption        | 14   |

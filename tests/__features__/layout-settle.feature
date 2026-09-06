Feature: Settled header height keys the glass
  glass-chrome-adoption-spec D2: ScreenHeader keys its GlassView on the
  measured content height (the effect applies only on first layout). A
  changed height must produce a new key; sub-point jitter within the same
  point must produce the same key so the material is not remounted for
  nothing.

  Scenario: A measurement is rounded up to a whole point
    When the layout reports 101.2
    Then the settled height should be 102

  Scenario: Sub-point jitter within the same point keys the same
    When the layout reports 101.7
    Then the settled height should be 102

  Scenario: A taller layout produces a new height
    When the layout reports 140
    Then the settled height should be 140

Feature: Re-locking covers the app instead of resetting it
  With Face ID on, leaving the app and coming back re-locks it. The lock
  used to UNMOUNT the whole app, so every unlock landed on the Assistant
  tab with any draft or open screen thrown away (user report, build 125).
  Now only the first lock of a launch keeps the app unmounted (guardrail 2:
  nothing renders before the first authentication), and later locks cover
  the still-mounted app.

  Scenario Outline: What the root layout renders
    Then ready <ready>, unlocked <unlocked>, unlocked once <once> should render "<view>"

    Examples:
      | ready | unlocked | once | view    |
      | no    | no       | no   | splash  |
      | yes   | no       | no   | splash  |
      | yes   | yes      | yes  | app     |
      | yes   | no       | yes  | covered |
      | no    | no       | yes  | splash  |

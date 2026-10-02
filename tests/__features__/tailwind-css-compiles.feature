Feature: The Tailwind stylesheet NativeWind compiles is valid CSS
  Tailwind scans every app/ and src/ file for class-name candidates, including
  regexes and strings that are not classes. A bracketed token with a colon
  (a regex character class like `[-:#]`) becomes an "arbitrary property" rule,
  and if that rule is not valid CSS, lightningcss rejects the whole sheet and
  the Metro bundle — so the device archive — fails. Nothing else catches it:
  typecheck, lint and jest never build the stylesheet.

  Scenario: The generated stylesheet parses
    When Tailwind builds the stylesheet from global.css
    Then lightningcss parses it without error

Feature: Only the design system's radii are used

  borderRadius used to sit under `extend`, so Tailwind's own scale still
  resolved alongside it and the app shipped 12px, 16px, 24px and 4px corners
  that exist nowhere in the design language — including three different corner
  radii on bottom sheets alone.

  Closing the scale does NOT turn a stray class into a build error: Tailwind
  emits nothing for a utility outside its scale, so `rounded-xl` would render
  square corners with no warning anywhere. This scenario is the guard.

  Scenario: No component uses a radius outside the token scale
    Given every tsx file under app and src
    Then none should use a rounded- class outside "sm, md, lg, pill, none"

  Scenario: No component uses an arbitrary pixel radius
    Given every tsx file under app and src
    Then none should use a rounded-[Npx] class

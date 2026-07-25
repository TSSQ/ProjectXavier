Feature: "What can I ask?" example prompts are well-formed
  The example deck behind AssistantExamplesSheet
  (src/domain/assistantExamples.ts) — pure data so its shape can be checked
  without mounting any screen. tests/__steps__/assistant-examples-routing.steps.ts
  covers the more important claim (every example actually routes as its group
  says); this suite covers the deck's basic shape.

  Scenario: There is at least one group
    When I read the assistant example groups
    Then there should be at least 1 group

  Scenario: Every group has a non-empty title and at least one example
    When I read the assistant example groups
    Then every group should have a non-empty title
    And every group should have at least 1 example

  Scenario: Every example has a non-empty label and text
    When I read the assistant example groups
    Then every example should have a non-empty label
    And every example should have a non-empty text

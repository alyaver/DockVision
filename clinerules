When creating or refining Jira stories, follow this structure and level of detail:

## Story template

### [Story number]. [Outcome-focused title]

**Description**

Describe the user or system outcome, the context/problem, and the scope. Be clear about what the story accomplishes without prescribing implementation unless needed to define behavior.

**Acceptance criteria**

- Use concise, observable, independently testable checklist items.
- Cover expected behavior, validation, error handling, state/persistence, and relevant edge cases.
- Specify important fields, statuses, ordering, responses, and side effects where applicable.
- State failure and boundary behavior explicitly; avoid vague phrases such as “works correctly.”
- Keep criteria within this story’s scope and do not duplicate neighboring stories’ responsibilities.

**Independent verification**

Describe concrete, focused scenarios that verify the criteria in isolation. Identify representative fixtures, expected results, and stubs/mocks for external dependencies where useful. Avoid requiring unrelated features or real destructive actions to perform verification.

**Integration boundary**

State what this story owns, what related stories own, and the contract or handoff between them. Identify coordination dependencies without taking over adjacent scope.

## Writing rules

- Number stories and use specific, action-oriented titles.
- Use consistent terminology for entities, fields, endpoints, and lifecycle states.
- Prefer user-visible behavior and system guarantees over implementation instructions.
- Include concurrency, lifecycle, and data-preservation requirements when relevant.
- Do not invent requirements, defaults, API fields, or dependencies. Flag unknowns for clarification.
- Make each story cohesive, independently verifiable, and explicit about its integration boundary.

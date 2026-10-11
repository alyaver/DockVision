---
name: jira-story-planning
description: Plan a DockVision Jira story before implementation, mapping acceptance criteria to repository evidence, affected boundaries, tests, and unresolved decisions. Use for story refinement or implementation planning, not for automatic Jira updates.
---

# Jira story planning

## Required context

Obtain the issue text, acceptance criteria, current workspace status, and applicable rules. Obtain the charter only when needed to establish product intent. If Jira or the charter is unavailable, use supplied text and disclose the limitation; do not invent access or requirements.

Resolve repository references against the actual workspace root and use absolute paths for tool calls. The initial workspace is `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`; do not assume teammates use the same drive.

## Procedure

1. Restate the outcome, in-scope behavior, and explicit non-goals.
2. Read the Jira story standard and inspect relevant code, callers, tests, and documentation. For launch changes, inspect the launch contract and both handoff endpoints.
3. Map each acceptance criterion to existing evidence, required changes, and an observable verification scenario. Distinguish missing implementation from missing evidence.
4. Identify validation, failure, lifecycle, concurrency, persistence, and data-preservation cases that apply. Do not manufacture requirements to fill the table.
5. List affected files and an ordered implementation plan. Separate prerequisites and adjacent-story responsibilities from this story's work.
6. Surface conflicting requirements and blocking decisions before implementation. Keep nonblocking assumptions explicit.

## Output and verification

Return outcome, scope, criterion/evidence/test mapping, proposed changes, dependencies, risks, and open questions. When drafting stories, use the existing numbered story template without substituting a different format.

Example: an admission-failure criterion should specify the expected response and preservation of the previous active pointer, using temporary storage and injected failure rather than a real guest run.

## Boundaries

Planning does not edit code or mutate Jira. Do not transition issues, change sprint membership, or claim acceptance from a merged PR. A cross-project gap review needs charter, Jira, and repository evidence and is not automatically included in a single-story plan.

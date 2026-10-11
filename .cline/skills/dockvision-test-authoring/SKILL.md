---
name: dockvision-test-authoring
description: Create or review DockVision regression, unit, and isolated integration tests using the existing Node test runner. Use for behavior changes, launch admission, task-plan validation, readiness retries, and storage preservation; not for live VM execution.
---

# DockVision test authoring

## Required context

Read the affected implementation, acceptance criteria, current manifests, and neighboring tests. Resolve references to absolute paths from the actual workspace root. Initial root: `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`.

Use the existing launch, launch-waiting, plan-validation, and pointer-publication suites as relevant examples. Inspect the root task-plan/custom-config suites for shared configuration behavior.

## Procedure

1. Choose the smallest useful test boundary. A pure function test is not the same as HTTP/storage integration; running many unit tests does not itself create integration coverage.
2. State the observable behavior and expected failure before writing assertions. For a regression, demonstrate failure against the old behavior when practical without overwriting user work.
3. Reuse `node:test` and `node:assert/strict`. Preserve the surrounding CommonJS or ES module format.
4. Use temporary directories and ephemeral local ports; register cleanup for owned resources. Stub readiness and external services. Inject time/sleep for retry tests instead of waiting in real time.
5. Cover applicable malformed input, boundary values, aliases, concurrent admissions, blocked states, and storage failures. Assert response fields and side effects, including what must remain unchanged.
6. Preserve whitespace and Unicode in runner/configuration fixtures. Store scripts as inert test data; never execute uploads.
7. Run focused tests and relevant suites. Investigate failures without disabling assertions or broadening production behavior just to pass a fixture.

## Commands and output

After checking current manifests, run from the resolved workspace root:

- `npm test -w server`
- `npm run test:task-plan`

For a focused file, invoke `node --test` with its quoted absolute path. Report command, result, skips, and uncovered behavior.

## Boundaries

Never point fixtures at the live guest share or production database. Frontend component-test tooling is a separate approval decision; do not install Vitest or Testing Library implicitly. A successful build is not proof of UI behavior or guest execution.

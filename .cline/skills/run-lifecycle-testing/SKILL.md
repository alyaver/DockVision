---
name: dockvision-run-lifecycle-testing
description: Test and verify DockVision launch, shared-storage, iteration, cancellation, and recovery changes without touching the live Windows VM share or starting destructive external services. Use when modifying run lifecycle code, writing regression tests, or validating launch-related work.
metadata:
  author: DockVision team
  version: "1.0.0"
---

# DockVision run lifecycle testing

Use this skill to prove that launch-lifecycle changes preserve the DockVision contracts without depending on the developer's live VM, Docker container, PostgreSQL data, or guest-agent process.

This skill owns verification practices. Lifecycle implementation rules belong to `dockvision-launch-lifecycle`.

## Existing test conventions

- Server tests use Node's built-in `node:test` runner and `node:assert/strict`.
- Server test files live in `server/test/*.test.js`.
- Task-plan tests live in `tests/task-plan.test.mjs`.
- Prefer dependency injection, temporary filesystem fixtures, and local ephemeral HTTP listeners.
- Follow nearby fixture, teardown, naming, and assertion patterns before introducing new helpers.
- Do not add a new test framework unless the task explicitly requires and justifies it.

## Non-negotiable isolation rules

- Never read, write, delete, prune, or publish test data in the repository's live `WindowsVm/shared` directory.
- Filesystem lifecycle tests must create a unique temporary shared root, normally with `fs.mkdtemp` under `os.tmpdir()`.
- When code resolves the shared root at module-load time:
  1. Save the previous `DOCKVISION_SHARED_ROOT` value.
  2. Set it to the temporary fixture path before requiring the module.
  3. Clear the relevant entries from `require.cache`.
  4. Restore or delete the environment variable during teardown.
  5. Remove the temporary directory during teardown.
- Tests must not start Docker, boot or stop the Windows VM, execute uploaded user scripts, connect to a real guest agent, send real email, or mutate a developer database.
- Stub readiness, VM status, publication failures, clocks, and other external dependencies where practical.
- A test may exercise the real local Windows filesystem behavior when that behavior is the subject of the test, but only inside its temporary fixture.

## Select tests from the change boundary

### Request validation

Cover representative valid and invalid input, including:

- malformed or non-object bodies
- missing or invalid `executionMode`
- required filenames and content
- built-in versus custom runner fields
- server-owned `taskType` and `payload`
- runner language/extension mismatch
- malformed custom JSON
- unknown run options
- option defaults and lower/upper boundaries
- structured error status, code, message, and `fieldErrors`

### Admission and readiness

Cover behavior such as:

- successful acceptance returns HTTP 202 and identifiers
- route aliases use the same contract
- stopped or missing VM produces the expected readiness conflict
- missing, stale, busy, malformed, or pre-container heartbeat blocks admission
- startup failure is actionable and publishes no run
- active, indeterminate, or unreadable state blocks admission
- concurrent requests cannot both publish into the same shared root
- pre-publication failures leave no guest-visible new pointer
- a failed attempt preserves the previous active pointer and existing run data

### Pointer publication

Cover behavior such as:

- first publication succeeds
- replacement succeeds through the normal rename path
- the Windows fallback replaces an existing pointer when applicable
- replacement failure preserves the old destination
- a helper error after a committed replacement is not reported as failed admission
- paths containing spaces or special characters are passed safely

Do not weaken or skip Windows-specific regression coverage merely to make a cross-platform test pass. Use a platform skip when the behavior genuinely requires Windows.

### Iterations and supervision

Cover behavior such as:

- the pre-published first iteration is not rewritten
- the next iteration is published only after the prior successful result
- durable completed counts advance exactly once
- an incomplete or temporarily invalid result is retried
- a non-completed terminal result stops subsequent publication
- final aggregate status and `finishedUtc` are written only at the proper boundary
- logs, pointer paths, task paths, result paths, screenshots, and artifacts remain iteration-scoped

### Cancellation and recovery

Cover behavior such as:

- cancellation before the next publication prevents more guest work
- cancellation does not destroy completed iteration records
- restart recovery resumes only an incomplete, internally consistent run
- recovery consumes an already-written result idempotently
- contradictory, missing, or terminal state is not automatically resumed
- repeated recovery/supervision does not double-count completed work

### Client launch flow

For pure client helpers, cover behavior such as:

- only known readiness 409 responses are retried
- validation, active-run conflicts, startup failure, and network uncertainty are not retried
- progress callbacks receive meaningful waiting state
- timeout produces the expected no-task-queued guidance
- abort stops future attempts
- acceptance returns immediately and is not repeated

## Fixture quality

- Build the smallest fixture that represents the contract under test.
- Use explicit representative run IDs, task IDs, statuses, timestamps, and iteration numbers.
- Keep timestamps deterministic when ordering or freshness matters.
- Assert both the intended result and important negative side effects.
- For failed admission, verify that no new active pointer or published run survives.
- For preservation behavior, snapshot important content before the action and compare afterward.
- Await asynchronous supervision or polling deterministically; do not rely on arbitrary long sleeps.
- Ensure every started listener, timer, temporary path, cache override, and environment override is cleaned up with test teardown.

## Required validation commands

Run the checks relevant to the changed boundary from the repository root:

```powershell
npm test -w server
npm run test:task-plan
npm run build -w client
```

Minimum expectations:

- Server lifecycle or API changes: run `npm test -w server`.
- Task-plan schema or serializer changes: run `npm run test:task-plan`.
- Client code changes: run `npm run build -w client`.
- Cross-boundary launch changes: run all three commands.

If a command cannot run because an external prerequisite is unavailable, report the exact command, error, and unverified boundary. Do not claim verification from code inspection alone.

## Regression-test workflow

1. Reproduce the defect or risky boundary with a focused failing test when possible.
2. Confirm that the test fails for the expected reason, not fixture setup.
3. Implement the smallest contract-preserving change.
4. Run the focused test, then the containing suite.
5. Run all validation commands required by the affected boundaries.
6. Inspect `git diff` and `git status` for accidental runtime artifacts or live shared-folder changes.
7. Summarize tests added, commands run, outcomes, and any remaining unverified behavior.

## Prohibited shortcuts

- Do not point tests at `WindowsVm/shared` for convenience.
- Do not delete an active pointer to make a test pass.
- Do not replace atomic publication with direct writes in test-only paths if production behavior is under test.
- Do not mock the exact behavior that the test claims to verify.
- Do not assert only HTTP status when stored files and preservation guarantees are part of the contract.
- Do not depend on test execution order or residue from another test.
- Do not silently skip failing tests or reduce coverage to obtain a green suite.

## What good looks like

- Tests are isolated, deterministic, and clean up after themselves.
- The live VM share and external services are untouched.
- Assertions verify durable state and important non-effects, not only return values.
- Windows-specific pointer behavior remains protected.
- Cross-boundary changes are validated by server tests, task-plan tests, and a client production build as applicable.

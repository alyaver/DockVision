---
name: dockvision-launch-lifecycle
description: Safely modify DockVision's end-to-end run launch lifecycle across the React client, Express server, VM shared storage, and guest-agent handoff. Use for changes to launch requests, readiness retries, validation, run admission, run state, iterations, cancellation, recovery, current-run pointers, or files under WindowsVm/shared.
metadata:
  author: DockVision team
  version: "1.0.0"
---

# DockVision launch lifecycle

Use this skill whenever a change can affect how DockVision creates, admits, publishes, monitors, resumes, cancels, or completes a test run.

## Read before editing

Inspect the relevant contract and implementation files before making changes:

- `docs/run-launch-contract.md`
- `client/src/lib/api.js`
- `client/src/lib/launchWhenReady.mjs`
- `client/src/lib/serializeTaskPlan.mjs`
- `server/lib/launchRequest.js`
- `server/lib/launchService.js`
- `server/lib/launchStore.js`
- `server/lib/runStore.js`
- `server/lib/runSupervisior.js`
- `server/lib/runRecovery.js`
- `server/lib/guestReadiness.js`
- `server/lib/publishPointer.js`
- `server/routes/RunLaunchRoutes.js`
- `WindowsVm/shared/agent.py`

Read only the files relevant to the requested change, but trace every affected field or lifecycle state across its producers and consumers.

## Integration boundaries

The lifecycle is divided into these responsibilities:

1. The client constructs a launch request and reports readiness progress.
2. The server validates the request and assigns authoritative task fields.
3. Admission verifies that no blocking run exists and that the guest is ready.
4. The server prepares run-scoped files before atomically publishing the active pointer.
5. The guest agent consumes the published task and writes run-scoped status, logs, results, screenshots, and artifacts.
6. The supervisor advances iterations and persists aggregate progress.
7. Recovery resumes only when durable state proves that doing so is safe.

Do not change one boundary without checking the adjacent producer and consumer.

## Request contract

- Preserve explicit `executionMode: "builtin" | "custom"` handling.
- The server owns `taskType` and `payload`; reject request-supplied values.
- Keep client request fields aligned with `validateLaunchRequest`.
- Built-in mode must validate and normalize its task plan through the existing validator. Do not introduce a parallel validator.
- Custom mode must preserve the uploaded runner and configuration text and validate the declared runner language and filename extension.
- Preserve the documented run option names and limits unless the requested work explicitly changes the contract:
  - `iterations`: integer from 1 through 30, default 1.
  - `captureIntervalSeconds`: 5, 10, 30, or 60, default 5.
  - `iterationTimeoutSeconds`: positive safe integer, default 300.
- If a field, default, status, or schema changes, update all affected client, server, agent, test, fixture, and contract-document consumers together.

## Client launch behavior

- Preserve the rule that uncertain network failures are never automatically retried. The server may have accepted the run even if the client did not receive the response.
- Automatically retry only explicit non-admission readiness responses currently recognized by `launchWhenReady.mjs`:
  - `GUEST_STARTING`
  - `GUEST_NOT_READY`
  - `AGENT_NOT_READY`
- Preserve the request payload while waiting for readiness.
- Stop readiness attempts after acceptance, a non-retryable error, timeout, or abort/navigation.
- Aborting the client wait must not imply that an already accepted backend run was cancelled.
- Preserve compatibility for the `dockvision-current-run` session-storage handoff unless a coordinated migration is part of the task.
- Keep user-facing errors actionable without claiming a run failed when acceptance is uncertain.

## Admission and shared-storage invariants

- Treat `WindowsVm/shared` as a transport root. New work belongs in run-scoped and, where applicable, iteration-scoped directories.
- Do not use a single global `task.json`, `result.json`, screenshots directory, or artifact directory for new lifecycle behavior.
- Admission must fail closed on unreadable, missing, indeterminate, or contradictory active-run records.
- Do not overwrite, cancel, or mark an existing run failed merely to admit a new one.
- Complete all fallible preparation before publishing `active/current-run.json`.
- Pointer publication is the admission commit point. Do not await new fallible work after that commit before returning acceptance.
- Publish through a same-directory temporary pointer and `publishPointer`; do not write the active pointer directly.
- Never unlink the previous active pointer before replacement.
- Preserve the Windows `File.Replace` fallback and its use of environment variables rather than interpolated PowerShell code.
- On preparation failure, clean up only unpublished files created by the failed attempt. Preserve the previous active pointer and existing runs.
- The current admission queue is process-local. Do not describe it as a distributed or interprocess lock.

## Lifecycle and recovery invariants

- Keep status transitions explicit and persist progress before exposing dependent work.
- A terminal `result.json` is authoritative for the iteration or run it represents.
- Only successful iterations increment the durable completed count.
- Do not publish a later iteration after a cancellation request is observed at an iteration boundary.
- Do not publish remaining iterations after a non-completed terminal result.
- Recovery must be idempotent and fail closed when persisted progress is missing or contradictory.
- Assume the backend can stop after writing a result but before updating metadata or publishing the next iteration. Changes must preserve safe recovery from this window.
- Maintain UTC ISO timestamps and distinguish aggregate run state from iteration state.
- Preserve existing stored user inputs, logs, results, screenshots, and artifacts unless retention or deletion is explicitly in scope.

## Guest-agent handoff

- Keep heartbeat fields compatible with `server/lib/guestReadiness.js`.
- A ready agent is fresh, idle, and not associated with another run.
- Heartbeats from before the current container start must not prove readiness.
- Keep task and result paths aligned with the pointer and server-generated envelopes.
- Handle partially written or temporarily invalid JSON as a synchronization condition where appropriate, rather than immediately corrupting state.
- Do not add arbitrary uploaded-code execution without explicit validation, isolation, timeout, logging, and result requirements.

## Error contract

Preserve structured launch errors:

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Actionable message",
  "fieldErrors": []
}
```

- Validation failures use HTTP 400 and identify relevant fields.
- Admission and readiness conflicts use HTTP 409.
- Unexpected storage/admission failures use HTTP 500 without implying that a new task was published.
- Include `activeRunId` when an active-run conflict provides it.

## Required change process

1. Trace changed data and state across the client, server, shared files, supervisor, recovery, and guest agent.
2. State which integration boundaries are affected.
3. Preserve the invariants above or explicitly document an intentional contract migration.
4. Add or update tests using the `dockvision-run-lifecycle-testing` skill.
5. Update `docs/run-launch-contract.md` when externally observable launch or storage behavior changes.
6. Report any deployment or backward-compatibility limitation in the final summary.

## What good looks like

- One authoritative launch contract is used across all entry points.
- A request is never duplicated because of an uncertain response.
- Existing active work and data survive failed admission attempts.
- No guest-visible task appears until its complete run state is prepared.
- Iteration progress can recover safely after a backend restart.
- Client, server, and guest-agent schemas remain synchronized.

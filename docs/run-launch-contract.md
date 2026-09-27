# Unified launch admission (Ticket 3)

## Scope and entry points

`POST /api/runs/start` and the compatibility URLs `/api/runs/start2` and
`/api/docker/start-smoke` delegate to the same service. All require the handbook
request body, including explicit `executionMode: "builtin" | "custom"`.
Legacy URLs are supported; inference from old request bodies is not.
Ticket 8 must update the UI request construction. This change does not implement
guest execution (Ticket 4), supervision/recovery (Ticket 5), or history (Ticket 7).

The existing `readTestScript({fileName, content})` validator was integrated from
DOCKV-289 commit `84d63abbb6f20479f9297b74d1535b95db9b7a59`, without merging its
route/store/worker changes. Local compatibility additions normalize legacy
`targetApp` and demo top-level named-control percentages. Coordinate imports
remain subject to guest/window bounds checks in the worker. Coordinate this file
with the Ticket 1 author when merging; do not introduce a parallel validator.

## Admission

1. Validate the request, built-in plan or custom JSON, and resolve run options.
2. Acquire the process-local admission queue for the shared directory.
3. Reject an active or indeterminate run without altering its files.
4. Check the guest container and a fresh, idle agent heartbeat.
5. Apply the existing terminal-run retention hook.
6. Write inputs, metadata (including container ID), task, and initial log.
7. Write a temporary pointer in `active`, then rename it to `current-run.json`.
8. Return 202 with `{success:true, runId, containerId}`.

Publication is the commit point; no fallible work is awaited after it. Preparation
failure removes the unpublished run folder and temporary pointer where possible,
without clearing the previous pointer. Rename behavior is covered using the local
Windows filesystem; deployments using different/network filesystems must verify
their rename guarantees. This is atomic visibility, not a power-loss durability
guarantee.

On Windows, replacement of an existing pointer can fail with `EPERM` on the
VM-shared directory even when first publication succeeds. `publishPointer` tries
rename first, then uses Windows `File.Replace` through a noninteractive PowerShell
helper for permission/existing-destination errors. Paths are passed through
environment variables, not interpolated code. It never unlinks the old pointer
first. Backup cleanup after successful replacement is best-effort. Regression
tests exercise the real Windows fallback and preservation on replacement failure.

**Deployment constraint:** one backend process per physical shared directory.
The queue is shared across service instances and aliases in that process, not
across processes or directory aliases/symlinks. Multi-process deployment needs an
interprocess lock. Ticket 5 must coordinate pointer/lifecycle writes with admission.

## State and readiness

A terminal `result.json` is authoritative. In its absence, matching terminal
metadata and task state permit admission. Otherwise the active pointer blocks,
including queued/running/cancelling, missing records, and inconsistent state.
Unreadable pointers/records fail closed. Launch admission never declares stale
work failed or cancels queued work. Ticket 5 owns recovery and final outcomes.

The default readiness adapter checks a running container with a resolved ID and
an idle agent with no run ID. Heartbeat freshness uses host-observed modification
time and the existing maximum of 60 seconds or three reported heartbeat intervals.
If the container is missing or stopped, admission calls the existing VM startup
service and returns `409 GUEST_STARTING`, asking the user to retry after boot.
The confirmation page handles readiness-only 409 responses automatically at
three-second intervals for up to five minutes, displaying progress and preserving
the request. It stops after acceptance, validation/conflict/startup failure, or an
uncertain network response. Individual HTTP attempts time out after 30 seconds;
an uncertain outcome is never automatically resent. Leaving the page aborts
further attempts, not any run already accepted by the backend. Full mode/settings
selection remains Ticket 8 work; the current upload flow explicitly uses custom.
No task is queued during startup. Startup errors return `409 GUEST_START_FAILED`.
The existing VM-start endpoint remains available. Heartbeats predating the
container's reported start time are rejected. Missing,
unreadable, stale, or busy heartbeat returns a useful 409. This is a pre-publication
readiness snapshot, not a guarantee that the guest cannot fail afterward.

## Stored handoff

Both envelopes contain `runId`, `taskId`, `status: "queued"`, `createdUtc`, and
resolved `runOptions`:

- `iterations`: integer 1–30, default 1.
- `captureIntervalSeconds`: 5/10/30/60, default 5.
- `iterationTimeoutSeconds`: positive safe integer, default 300.

Built-in: `taskType: "task_sequence"`, with normalized plan as `payload`, including
`payload.tasks`. `task-plan.json` stores that same normalized plan.

Custom: `taskType: "script_runner"`, with `payload.runnerPath`, `configPath`,
`runnerScriptLanguage`, `runnerScriptName`, and `configFileName`. Paths are relative
to the run directory. Canonical files are `uploaded-runner.py` or
`uploaded-runner.ps1` and `uploaded-task-plan.json`. Runner and configuration text
are preserved; custom JSON does not pass through the built-in validator.

Both modes preserve submitted configuration text in `uploaded-config.json` and
write `meta.json`, `task.json`, `logs/task.log`, and output directories. Metadata
includes execution mode, resolved options, input paths, and timestamps for later
history/supervisor work. Request-supplied `taskType` and `payload` are rejected.

## Errors and verification

Errors have `{success:false, code, message, fieldErrors:[]}`; validation errors
identify fields. Active conflicts include `activeRunId`. Invalid requests return
400; admission/readiness conflicts return 409; unexpected storage errors return
500. Parser size limits retain Express's existing default and return structured
413 errors when exceeded.

Run `npm test -w server` from the repository root. Tests start a local HTTP listener
on an ephemeral port, use temporary storage and stub readiness, inspect envelopes,
and test malformed input, aliases, concurrency, blocked states, and injected write
and rename failures. The readiness adapter is separately tested with a stubbed VM
status source. No tests start Docker, execute uploaded code, or publish to the live
guest share. Node's built-in test runner is used; no test dependency was added.
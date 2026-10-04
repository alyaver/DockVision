## Scope

The implementation will replace the active PowerShell VM agent with the most recent repository version of `vm-notepad-runner.py`.

The final Python file must handle both:

1. DockVision VM agent responsibilities
2. Built-in Notepad task execution

The existing execution contract, dashboard behavior, run lifecycle, task data, status reporting, and custom runner behavior must remain unchanged.

No files should be deleted until the replacement has been implemented and verified.

---

# Piece 1: Establish the Current Contracts and Baseline

## Work to Perform

Before modifying code:

1. Identify the most recent tracked `vm-notepad-runner.py`.

2. Confirm whether more than one production or demo copy exists.

3. Identify the active `DockVisionAgent.ps1` startup path.

4. Record the current files used for:

   - Agent startup
   - Scheduled-task registration
   - Heartbeats
   - Active-run detection
   - Task status updates
   - Result writing
   - Cancellation
   - Timeout handling
   - Screenshots
   - Custom Python runners
   - Custom PowerShell runners

5. Trace the existing backend contract for:

   - `current-run.json`
   - `task.json`
   - `result.json`
   - `cancel-request.json`
   - `agent-heartbeat.json`
   - Iteration-specific paths

6. Run the existing application tests and record the baseline result.

7. Run one valid built-in Notepad task through the current PowerShell implementation and record:

   - Task order
   - CLICK behavior
   - TYPE behavior
   - Heartbeat states
   - Task status changes
   - Result contents
   - Logs
   - Screenshots
   - Artifacts

8. Record the current behavior of one custom Python runner and one custom PowerShell runner.

9. 
Record the exact selected source path and commit or branch revision of the `vm-notepad-runner.py` chosen for implementation.


## Do Not Assume

- Do not assume the `docs` copy is automatically the production copy.
- Do not assume the current PowerShell and Python result formats are identical.
- Do not assume a timeout status name without checking the existing contract.
- Do not assume the Python runtime or `pywinauto` is installed.
- Do not delete or rename any file in this piece.

## Done When

- The active PowerShell startup path is documented.
- The exact Python source file to be used is identified.
- The current task, heartbeat, cancellation, timeout, result, and artifact contracts are documented.
- Baseline tests have been run.
- Baseline built-in, custom Python, and custom PowerShell behaviors are recorded.
- Any contract mismatch is listed as an implementation requirement rather than silently assumed.

## Acceptance

This piece is accepted only when an implementing AI can identify exactly:

- Which Python file will become the runtime file
- Which files currently launch `DockVisionAgent.ps1`
- Which files must be updated
- What behavior must remain unchanged
- What output must match the PowerShell baseline

---

# Piece 2: Define the Single-File Python Structure

## Work to Perform

Refactor the selected `vm-notepad-runner.py` so it contains clearly separated internal sections for:

### Agent functionality

- Shared-folder resolution
- Directory creation
- Single-instance protection
- Heartbeat writing
- Active-run pointer reading
- Task reading
- Task status updates
- Result writing
- Run logging
- Cancellation detection
- Timeout supervision
- Screenshot scheduling
- Runtime error handling
- Agent loop

### Built-in Notepad functionality

- Task-plan loading
- Plan validation
- Notepad startup
- Notepad focus handling
- CLICK execution
- TYPE execution
- Target resolution
- Artifact creation
- Notepad-specific result details

### Custom runner functionality

- Uploaded Python runner execution
- Uploaded PowerShell runner execution
- Runner output capture
- Exit-code handling
- Runner result parsing
- Error normalization

Preserve the existing user-uploaded runner contract independently from built-in Notepad execution.

Do not route `script_runner` tasks through the built-in Notepad task interpreter.

The single Python file must support both:

- Long-running VM agent mode
- Existing standalone `--plan` Notepad runner mode

Agent mode must dispatch based on `taskType`:

- `task_sequence` → built-in Notepad execution
- `script_runner` → uploaded Python or PowerShell process execution

The runtime file must provide two explicit modes:

Agent mode:

```text
python vm-notepad-runner.py --agent
```

Standalone built-in runner mode:

```text
python vm-notepad-runner.py --plan <configPath>
```

The installer and scheduled task must invoke:

```text
python <deployed-path>\vm-notepad-runner.py --agent
```

The `--plan` mode must remain compatible with the existing standalone Notepad runner behavior.

The implementation must remain in one Python file. A second runtime agent file must not be introduced.

## Done When

- The selected `vm-notepad-runner.py` contains both agent and built-in execution logic.
- The file has clear internal boundaries between generic agent behavior and Notepad-specific behavior.
- Agent mode and built-in execution mode can be tested independently through internal functions or explicit command-line modes.
- No functionality has been silently removed from the existing PowerShell behavior.

## Acceptance

- One Python file contains the required runtime behavior.
- The file can start in long-running agent mode.
- The file can execute a built-in task plan.
- The file can route custom Python and PowerShell runners.
- The implementation does not require `agent.py` at runtime.
- `agent.py` must not be imported, launched, copied, or required indirectly by the production VM startup path. It may remain in the repository only as historical or test code unless Piece 1 proves that it is an active runtime dependency.
- A user-uploaded Python runner executes using the existing invocation contract.
- A user-uploaded PowerShell runner executes using the existing invocation contract.
- Replacing `DockVisionAgent.ps1` does not change the behavior of the Custom Runner dashboard flow.

---

# Piece 3: Implement Shared-Root, Run-Context, and Path Handling

## Work to Perform

Implement the existing run-directory behavior in Python.

The Python agent must:

1. Resolve the shared folder using the same valid runtime locations used by the current agent.
2. Create or verify required directories.
3. Read `active/current-run.json`.
4. Resolve the active run ID.
5. Support the channel paths provided by the active pointer.
6. Support both root run paths and iteration-specific paths.
7. Resolve runner and task-plan paths relative to the active run directory.
8. Reject paths that resolve outside the active run directory.
9. Handle missing, unreadable, or malformed pointers safely.

Required path categories include:

```text
runs/<run-id>/task.json
runs/<run-id>/result.json
runs/<run-id>/logs/
runs/<run-id>/screenshots/
runs/<run-id>/artifacts/
runs/<run-id>/iterations/
```

## Done When

- The Python agent reads the same active-run pointer format as the current system.
- Root and iteration-specific paths resolve correctly.
- Path traversal outside the run directory is rejected.
- Missing or malformed paths produce logged errors.
- No task is executed using an invalid or unrelated run context.

## Acceptance

- A valid root run is found and processed.
- A valid iteration run is found and processed.
- A missing pointer leaves the agent idle.
- A malformed pointer does not crash the agent.
- A path outside the run directory is rejected with a clear error.

---

# Piece 4: Implement Heartbeat and Agent Lifecycle

## Work to Perform

Implement the heartbeat behavior using the existing `agent-heartbeat.json` structure.

The agent must write:

### Idle state

```text
status: idle
taskName: waiting_for_task
runId: empty
```

### Running state

```text
status: running
taskName: current task type
runId: active run ID
```

The heartbeat must preserve the required agent and machine fields.

The agent loop must:

1. Initialize the shared root.
2. Write startup logs.
3. Write an initial heartbeat.
4. Check for queued work.
5. Process one task.
6. Recover from task-level errors.
7. Return to idle.
8. Continue monitoring.

Implement single-instance protection so two copies cannot process the same task.

## Done When

- The Python file can remain running as the VM agent.
- The heartbeat is written while idle.
- The heartbeat changes while a task is active.
- The heartbeat returns to idle after completion, failure, cancellation, or timeout.
- A task failure does not terminate the agent loop.
- A second agent instance cannot process the same run.

## Acceptance

- Backend readiness recognizes the Python heartbeat.
- The heartbeat contains valid timestamps and run IDs.
- The agent remains available after a failed task.
- Starting the agent twice does not cause duplicate task execution.

---

# Piece 5: Implement Task Lifecycle and Result Handling

## Work to Perform

Implement the task lifecycle using the existing task and result files.

For a queued task:

1. Read `task.json`.
2. Confirm the task is associated with the active run.
3. Change the task status to `running`.
4. Add the start timestamp.
5. Write the updated task file.
6. Execute the task.
7. Write the result.
8. Change the task status to its final state.
9. Add the completion timestamp.
10. Return the heartbeat to idle.

Supported final states must include the existing contract’s statuses for:

- Completed
- Failed
- Cancelled
- Timed out, if the existing contract distinguishes it

The implementation must not invent a new status without checking the backend’s current status handling.

Results must include the existing required fields:

- Run ID
- Task ID
- Status
- Completion timestamp
- Message
- Artifacts
- Execution details when available

## Done When

- Tasks transition from `queued` to `running`.
- Tasks reach the correct final status.
- Results are written to the expected run-specific result path.
- A completed task cannot be executed again.
- Failed and cancelled tasks produce results instead of leaving the run stuck.

## Acceptance

- The backend displays the correct final status.
- Task and result files agree on the final status.
- Run metadata can be synchronized from the task and result files.
- A later run can start after a previous run reaches a final state.

---

# Piece 6: Integrate Built-In Notepad Execution

## Work to Perform

Connect the `task_sequence` task type to the built-in Notepad logic inside the same Python file.

The built-in execution must:

1. Read the normalized plan from the active task payload or task-plan file.

2. Open Notepad.

3. Focus the correct Notepad window.

4. Resolve supported CLICK targets.

5. Execute CLICK actions in order.

6. Execute TYPE actions in order.

7. Preserve exact TYPE text.

8. Support:

   - Spaces
   - Punctuation
   - Unicode
   - Tabs
   - Line breaks

9. Record per-task results.

10. Create the expected screenshots and artifacts.

11. Return a result compatible with the existing DockVision result flow.

The implementation must preserve the existing target registry and supported Notepad behavior unless the baseline comparison identifies a required compatibility correction.

## Done When

- A normalized built-in plan executes through the single Python file.
- CLICK and TYPE actions execute once and in order.
- Task data is not altered during execution.
- Notepad artifacts are written to the active run directories.
- Built-in execution does not write results to a script-relative demo directory.

## Acceptance

- The same valid plan used in the PowerShell baseline completes through Python.
- The task order matches the plan.
- TYPE text matches exactly.
- CLICK targets resolve or fail with a clear task-specific error.
- The result contains the expected task and artifact information.

---

# Piece 7: Implement Cancellation, Timeout, and Process Supervision

## Work to Perform

Implement cancellation and timeout behavior for active execution.

The agent must:

1. Check the run’s cancellation request while execution is active.
2. Detect a cancellation request with the existing cancellation contract.
3. Stop the active operation safely.
4. Terminate any child processes created for custom runners.
5. Handle Notepad cleanup where possible.
6. Enforce the configured iteration timeout.
7. Record the correct final result.
8. Restore the idle heartbeat.

The implementation must distinguish:

- Normal completion
- Failure
- Cancellation
- Timeout

If the existing backend collapses timeout into `failed`, use that existing contract rather than adding an incompatible status.

## Done When

- Cancellation stops active work.
- Timeout stops work that exceeds the configured limit.
- The run receives a final result.
- The agent remains alive.
- A later run can execute.

## Acceptance

- A cancelled run is not reported as completed.
- A timed-out run is not left in `running`.
- Child runner processes do not remain active after cancellation or timeout.
- The heartbeat returns to idle.
- The next valid run can start.

---

# Piece 8: Preserve Custom Python and PowerShell Runners

## Work to Perform

Implement the existing `script_runner` behavior inside the single Python agent without routing custom runners through the built-in Notepad interpreter.

The custom-runner path must remain independent from built-in `task_sequence` execution.

For custom runners:

Read the following fields from `task.payload`:

- `runnerPath`
- `configPath`
- `runnerScriptLanguage`
- `runnerScriptName`
- `configFileName`

Resolve `runnerPath` and `configPath` relative to the active run directory.

Reject paths that:

- Do not exist
- Resolve outside the active run directory
- Refer to directories instead of files
- Do not match the configured runner language

Preserve the existing canonical uploaded file names:

```text
uploaded-runner.py
uploaded-runner.ps1
uploaded-task-plan.json
```

For uploaded Python runners, use the configured Python executable and preserve the existing invocation contract:

```text
python <runnerPath> --plan <configPath>
```

For uploaded PowerShell runners, preserve the existing invocation contract:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <runnerPath> -ConfigPath <configPath>
```

Do not assume that an uploaded runner is the built-in Notepad runner.

Do not import, modify, or inject DockVision-specific Notepad behavior into the uploaded runner.

Capture:

- Standard output
- Standard error
- Process ID
- Exit code
- Start time
- Completion time

Supervise the uploaded process until it exits, is cancelled, or reaches its timeout.

During supervision:

- Check for cancellation requests.
- Enforce the configured iteration timeout.
- Capture scheduled screenshots using the active run paths.
- Terminate the complete child-process tree when cancellation or timeout occurs.
- Continue keeping the VM agent alive after the runner exits.

Parse the uploaded runner’s standard output using the existing result contract.

The implementation must follow the existing `ConvertFrom-RunnerOutputJson` behavior exactly. It must not invent a new stdout format or silently change whether diagnostic stdout is accepted. If the existing parser requires the complete stdout value to be valid JSON, preserve that behavior and record incompatible output as a failed result.

A valid result with `status: "completed"` must remain completed. Existing non-completed statuses must be handled according to the current PowerShell behavior rather than being silently converted to completed.

Treat the following as failures:

- Missing runner file
- Missing configuration file
- Unsupported runner language
- Python unavailable
- PowerShell unavailable
- Nonzero process exit code
- Empty standard output
- Malformed JSON output
- Runner result with an incompatible failure status
- Result that cannot be normalized into the DockVision result format

Preserve valid runner output and normalize it only as needed to add required DockVision fields, such as:

- `runId`
- `taskId`
- `status`
- `finishedUtc`
- `message`
- `artifacts`
- `details`

Write the normalized result to the same run-specific `result.json` path used by the existing PowerShell agent.

Preserve standard error and process failure information in the run log and result details without corrupting valid standard output.

A failed custom runner must not terminate the long-running Python agent.

A completed custom runner must not be followed by built-in Notepad execution unless the task explicitly has a separate built-in task.

## Compatibility Requirements

The following behavior must remain unchanged:

| Runner type | Required invocation |
| --- | --- |
| Uploaded Python runner | `python <runnerPath> --plan <configPath>` |
| Uploaded PowerShell runner | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <runnerPath> -ConfigPath <configPath>` |

The implementation must preserve:

- `taskType: "script_runner"`
- `payload.runnerPath`
- `payload.configPath`
- `payload.runnerScriptLanguage`
- `payload.runnerScriptName`
- `payload.configFileName`
- Uploaded configuration contents
- Uploaded runner contents
- Standard output result parsing
- Standard error capture
- Timeout behavior
- Cancellation behavior
- Completion screenshots
- Periodic screenshots
- Run logs
- Artifact paths
- Final result format
- Backend-visible final status

## Done When

- Uploaded Python runners still execute successfully.
- Uploaded PowerShell runners still execute successfully.
- Custom runners receive the same command-line arguments as before.
- Custom runners can use paths containing spaces.
- Custom runner configuration files remain available at the expected paths.
- Custom runner stdout is parsed using the existing result contract.
- Custom runner stderr is preserved for diagnostics.
- Nonzero exit codes produce failed results.
- Empty output produces a failed result.
- Malformed JSON produces a failed result.
- Missing runners and missing configurations produce clear failed results.
- Cancellation terminates the uploaded process tree.
- Timeout terminates the uploaded process tree.
- The agent remains available after custom-runner success or failure.
- A custom runner cannot accidentally execute built-in Notepad logic.
- The existing Custom Runner dashboard behavior remains unchanged.

## Acceptance

The following scenarios must pass:

- A valid uploaded Python runner completes.
- A valid uploaded PowerShell runner completes.
- A Python runner receives the correct `--plan` argument.
- A PowerShell runner receives the correct `-ConfigPath` argument.
- A runner path containing spaces completes.
- A missing runner fails clearly.
- A missing configuration fails clearly.
- An unsupported language fails clearly.
- A nonzero exit code produces a failed result.
- Empty stdout produces a failed result.
- Malformed JSON stdout produces a failed result.
- Valid stdout with diagnostic stderr still completes successfully.
- Cancellation terminates the runner and produces a cancelled result.
- Timeout terminates the runner and produces the existing timeout or failed status.
- Periodic and completion screenshots use the active run directories.
- The agent returns to idle after every custom-runner outcome.
- A later built-in or custom run can start after a previous custom run finishes.
- Removing `DockVisionAgent.ps1` does not break uploaded Python or PowerShell runners.

---

# Piece 9: Implement Screenshots, Logs, and Artifacts

## Work to Perform

Preserve the existing run-specific output behavior.

The Python agent and built-in runner must:

- Write startup and agent-loop messages to the agent log.
- Write task lifecycle messages to the run task log.
- Write screenshots to the active screenshots directory.
- Write Notepad artifacts to the active artifacts directory.
- Use iteration-specific directories when the active pointer specifies them.
- Store result artifact paths using the existing relative-path format.
- Continue execution if an optional screenshot fails, while recording a warning.
- Fail clearly if required result or task files cannot be written.

## Done When

- Logs are written to the expected locations.
- Screenshots are written to the expected locations.
- Artifacts are written to the expected locations.
- The application can display the resulting artifacts.
- Optional screenshot failure does not incorrectly mark a successful task as failed.

## Acceptance

- The Python result matches the PowerShell baseline’s required artifact structure.
- Run logs contain start, execution, completion, and failure events.
- The dashboard or run page can locate generated artifacts.
- Iteration artifacts are not written into the wrong iteration.

---

# Piece 10: Update VM Installation and Scheduled Startup

## Work to Perform

Update:

```text
WindowsVm/shared/install-agent.bat
```

The installer must:

1. Locate the selected production `vm-notepad-runner.py`.
2. Copy it to the VM agent directory.
3. Ensure the configured Python runtime is available.
4. Ensure dependencies required by the built-in Notepad implementation are available, including `pywinauto`, before starting the agent.
5. Stop any existing PowerShell agent process.
6. Stop or replace the existing scheduled task.
7. Start the Python agent.
8. Register the scheduled task to start Python on login.
9. Avoid launching `DockVisionAgent.ps1`.

The scheduled-task name may remain unchanged only if doing so preserves existing behavior and references. The command must point to Python and the Python file.

## Done When

- Installation deploys the Python runtime file.
- The VM starts the Python file instead of the PowerShell file.
- The scheduled task points to Python.
- Existing PowerShell processes are stopped or prevented from restarting.
- Python startup failures are visible in logs.

## Acceptance

- A clean or refreshed VM starts the Python agent.
- The Python agent writes a heartbeat after startup.
- The scheduled task no longer references `DockVisionAgent.ps1`.
- Restarting the VM does not bring back the PowerShell agent.

---

# Piece 11: Remove Active PowerShell Dependencies

## Work to Perform

Search and update all active references to `DockVisionAgent.ps1` in:

- Install scripts
- Scheduled-task commands
- Runtime manifests
- Build configuration
- Packaging configuration
- Runtime diagnostics
- Startup commands
- Documentation that describes active runtime behavior

Do not alter historical run artifacts solely because they contain old references.

Remove `DockVisionAgent.ps1` only after all prior pieces pass.

## Done When

- No active runtime path launches the PowerShell agent.
- No active build or packaging path requires it.
- Runtime diagnostics report the Python implementation.
- The PowerShell file can be removed without preventing startup or execution.

## Acceptance

After removing `DockVisionAgent.ps1`:

- The VM starts.
- The Python agent starts.
- The heartbeat is written.
- A built-in task executes.
- The application receives the result.
- Custom runners continue to function.
- Removing `DockVisionAgent.ps1` must not remove or disable the PowerShell executable used to run user-uploaded `.ps1` custom runners. The PowerShell agent file is being removed; PowerShell itself remains a supported custom-runner runtime.
- `script_runner` execution must continue to support uploaded PowerShell files even though `DockVisionAgent.ps1` is no longer used as the VM supervisor.
- No stale scheduled task points to the PowerShell file.

---

# Piece 12: Automated Tests

## Work to Perform

Add or update tests for non-UI behavior.

Test the Python implementation where the repository’s test setup permits it. Test at minimum:

### Heartbeat

- Idle heartbeat
- Running heartbeat
- Return to idle
- Required fields
- Valid timestamps

### Task lifecycle

- Queued to running
- Running to completed
- Running to failed
- Running to cancelled
- Timeout finalization
- Duplicate execution prevention

### File handling

- Missing pointer
- Invalid pointer
- Missing task file
- Invalid task JSON
- Missing run directory
- Unsafe relative path
- Missing result directory

### Runner handling

- Successful Python runner
- Successful PowerShell runner
- Nonzero exit code
- Empty output
- Malformed JSON output
- Standard error output
- Missing runner
- Missing config

### Built-in plan handling

- CLICK task
- TYPE task
- Mixed ordered tasks
- Unicode
- Tabs
- Line breaks
- Invalid target
- Unsupported action
- Empty or malformed plan

Use mocks or fake processes for process-supervision tests. Do not require every automated test to launch a real interactive Notepad VM.

## Done When

- The new Python lifecycle behavior is covered by automated tests.
- Existing JavaScript tests still pass.
- Tests do not depend on destructive real VM actions unless specifically marked as VM validation.

## Acceptance

The following existing commands pass:

```text
npm test -w server
npm run test:task-plan
```

Any new Python test command must also pass and be documented in the final implementation summary.

---

# Piece 13: Interactive VM Validation

## Work to Perform

Run the required tests on the actual Windows VM when the VM environment is available. If the VM is unavailable, run all possible local tests and document every unexecuted VM validation explicitly. Do not claim VM validation was completed if it was not performed

Test in this order:

1. Start the VM.
2. Confirm the Python agent starts.
3. Confirm an idle heartbeat.
4. Submit a valid built-in plan.
5. Confirm running heartbeat.
6. Confirm CLICK and TYPE order.
7. Confirm exact TYPE text.
8. Confirm result, logs, screenshots, and artifacts.
9. Confirm completed heartbeat state.
10. Submit a failing plan.
11. Confirm failed result and idle recovery.
12. Submit another valid plan.
13. Confirm the next run succeeds.
14. Cancel an active run.
15. Confirm cancellation result and idle recovery.
16. Run a task exceeding its timeout.
17. Confirm timeout result and idle recovery.
18. Run a custom Python runner.
19. Run a custom PowerShell runner.
20. Test missing Python.
21. Test missing `pywinauto`.
22. Test missing runner file.
23. Test malformed runner output.
24. Test a path containing spaces.
25. Remove `DockVisionAgent.ps1`.
26. Restart the VM.
27. Confirm Python startup, heartbeat, and built-in execution again.

## Done When

- All required normal and failure scenarios have recorded results.
- The Python agent survives task failures, cancellation, and timeouts.
- Multiple sequential runs work.
- Both custom runner types still work.
- The VM works without `DockVisionAgent.ps1`.

## Acceptance

The Python implementation matches the recorded PowerShell baseline for:

- Task order
- Task data
- Status transitions
- Results
- Logs
- Screenshots
- Artifacts
- User-visible completion behavior

---

# Piece 14: Final Regression and Cleanup

## Work to Perform

1. Run the full application build.
2. Run all existing automated tests.
3. Run all new Python tests.
4. Search for stale active references to `DockVisionAgent.ps1`.
5. Confirm the scheduled task command.
6. Confirm runtime manifests.
7. Confirm the installer.
8. Confirm no duplicate production runner copies are being used.
9. Remove `DockVisionAgent.ps1`.
10. Re-run startup and built-in execution validation after removal.
11. Confirm the working tree contains only intended changes.
12. Confirm that `powershell.exe` remains available for uploaded PowerShell custom runners.
13. Confirm that removing `DockVisionAgent.ps1` removes only the active supervisor dependency, not uploaded PowerShell runner support.
14. Run one uploaded Python runner after PowerShell-agent removal.
15. Run one uploaded PowerShell runner after PowerShell-agent removal.
16. Confirm that both custom runners still use the original argument conventions and result contract.

## Done When

- The application builds.
- Existing tests pass.
- New tests pass.
- The VM works without the PowerShell agent.
- Built-in Notepad uses only the single Python file.
- Custom Python and PowerShell runners still work.
- No active dependency on `DockVisionAgent.ps1` remains.

## Final Acceptance

The Jira task is complete only when all of the following are true:

- `vm-notepad-runner.py` is the only DockVision-owned VM supervisor and built-in Notepad runtime file. User-uploaded `uploaded-runner.py` and `uploaded-runner.ps1` files remain supported child processes for `script_runner` tasks.

The intended runtime architecture is:

```text
vm-notepad-runner.py
  ├── DockVision VM agent
  ├── built-in Notepad executor
  └── supervisor for user-uploaded Python/PowerShell runners

uploaded-runner.py / uploaded-runner.ps1
  └── user-provided child process, not DockVision-owned runtime
```
- It runs continuously as the VM agent.
- It writes idle and running heartbeats.
- It detects active runs and queued tasks.
- It updates task statuses correctly.
- CLICK and TYPE tasks execute once and in order.
- TYPE text is preserved for spaces, punctuation, Unicode, tabs, and line breaks.
- Results use the expected run-specific paths.
- Logs, screenshots, and artifacts use the expected directories.
- Failures, cancellation, and timeout are handled safely.
- The agent returns to idle after every final outcome.
- A failed or cancelled run does not block the next run.
- Missing files, invalid plans, unsupported actions, and runtime errors produce clear failures.
- Custom Python and PowerShell runners continue to work.
- The one-file Python agent preserves the existing `script_runner` contract.
- Uploaded Python runners still receive `--plan <configPath>`.
- Uploaded PowerShell runners still receive `-ConfigPath <configPath>`.
- Custom runners execute independently from built-in Notepad tasks.
- Removing `DockVisionAgent.ps1` does not remove support for uploaded PowerShell runners.
- Custom Python and PowerShell runs continue to produce compatible results, logs, screenshots, artifacts, and statuses.
- The installer and scheduled task start Python instead of PowerShell.
- No active runtime, build, packaging, configuration, or manifest dependency requires `DockVisionAgent.ps1`.
- The application builds and existing automated tests pass.
- The VM starts and executes successfully after `DockVisionAgent.ps1` is removed.
- The behavior matches the recorded PowerShell baseline.

## Final Review Against the Jira Task

The plan explicitly covers:

- Single-file Python implementation
- VM agent responsibilities
- Built-in Notepad execution
- Heartbeats
- Active-run and queued-task detection
- Task status transitions
- CLICK and TYPE ordering
- Exact TYPE text preservation
- Logs, screenshots, artifacts, and results
- Failures, cancellation, and timeouts
- Idle recovery
- Missing runtime and dependency failures
- Duplicate agent startup
- Invalid pointers, plans, and task files
- Invalid CLICK targets
- Malformed runner output
- Standard error and nonzero exit codes
- Notepad startup/focus/control failures
- Sequential runs
- Paths containing spaces
- Stale PowerShell references
- Installer and scheduled-task migration
- Custom Python and PowerShell runner regression
- Application build and existing test execution
- Removal of `DockVisionAgent.ps1` only after verification 


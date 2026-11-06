# DOCKV-333: Windows guest execution and cleanup testing evaluation

## Outcome

This evaluation establishes a repeatable, host-safe way to test the DockVision
guest-agent lifecycle and identifies which checks still require an authorized
Windows guest. It evaluates `unittest` against `pytest` without migrating the
repository test suite or changing production guest behavior.

## Recommendation

Retain Python's built-in `unittest` as the repository baseline.

The existing suite already uses `unittest.TestCase`, temporary directories,
`unittest.mock`, subtests, and controlled executor boundaries. It runs without
installing another test framework and currently provides 34 lifecycle tests.
The DOCKV-333 unittest sample follows the same conventions and adds four
concise, reproducible cases, including owned-window cleanup preservation.

`pytest` is a credible future research option because it provides assertion
introspection, automatic discovery, fixtures, parametrization, output capture,
and a plugin ecosystem. It was evaluated in a disposable Python 3.10 virtual
environment outside the repository; it is not installed into the project and
is not a repository dependency. It can run existing `unittest` suites, so a
future evaluation could compare it without rewriting these tests.

## Framework comparison

| Concern | `unittest` | `pytest` | Decision for this story |
| --- | --- | --- | --- |
| Availability | Python standard library | Third-party package; unavailable in the current environment | Keep `unittest` |
| Fixtures and cleanup | `setUp`, `tearDown`, `addCleanup`, and temporary directories | Fixtures with scopes and dependency injection | Existing `unittest` lifecycle is sufficient |
| Parameterization | `subTest` and explicit loops | `parametrize` and fixture parameterization | Useful pytest feature, but not enough to justify migration |
| Assertions | `assertEqual`, `assertTrue`, rich sequence/dict helpers | Plain `assert` with detailed introspection | Pytest is more concise; current diagnostics are adequate |
| Mocking | `unittest.mock` in the standard library | Commonly used with `monkeypatch` and external mocking tools | Existing mocks already isolate GUI/process boundaries |
| Discovery | `unittest` discovery and explicit module commands | Automatic test discovery and configurable collection | Both are reproducible for this suite |
| Diagnostics | Text runner, verbosity, subtest names, assertion diffs | Strong failure reports, output/log capture, plugins | Pytest would improve ergonomics, not lifecycle correctness |
| Windows/guest compatibility | Uses the interpreter and dependencies already selected by the project | Adds a framework dependency to every environment that runs it | Avoid new setup and CI cost for this task |
| CI/setup | No additional package installation | Requires pinned installation and cache/availability policy | No migration in DOCKV-333 |

The comparison is based on the official Python `unittest` and pytest
documentation. The selected framework does not determine whether GUI behavior
is real: pywinauto still requires a Windows GUI environment and its configured
backend. Host-safe lifecycle tests must keep GUI and process effects injected
or stubbed.

## Existing coverage inventory

### Runtime copy under test

`tests/vm_agent_lifecycle_test.py` imports:

```text
docs/pywinauto-vm-notepad-demo/vm-notepad-runner.py
```

The installer can deploy:

```text
WindowsVm/shared/vm-notepad-runner.py
```

These files are now byte-identical and have the same SHA-256 hash. The Python
suite and deployment-equivalence test therefore cover the same runner bytes.
Neither result alone proves that the installed guest is running the same bytes.
This equivalence gap is recorded rather than silently treated as passed.

### Existing lifecycle evidence

The established `unittest` suite covers:

- queued task success and terminal result publication;
- controlled executor failure;
- cancellation before and during execution;
- iteration timeout and cooperative cancellation;
- Notepad cleanup after cancellation or automation failure;
- orphaned running-task recovery without re-execution;
- terminal-task no-reexecution behavior;
- bounded agent-loop processing;
- task-plan and run-scoped artifact handling;
- path confinement and diagnostic artifacts.

## Reproducible host-safe sample

The focused unittest sample is:

```text
tests/vm_agent_lifecycle_sample_test.py
```

It uses a temporary shared directory, an active-run pointer, and an injected
executor. It demonstrates:

1. Successful completion writes a terminal task/result and restores an idle
   heartbeat with no active `runId`.
2. A controlled execution exception writes a failed terminal result and a later
   polling cycle does not invoke the executor again.
3. Cancellation requested before execution writes a cancelled terminal result
   without invoking the executor and restores the idle heartbeat.
4. A worker failure closes only the run-owned mocked window and leaves an
   unrelated mocked window untouched.

Run the focused sample with:

```powershell
python -m unittest -v tests/vm_agent_lifecycle_sample_test.py
```

An equivalent three-case pytest sample was created and run only in the
disposable comparison environment outside the repository with:

```powershell
$envDir = Join-Path $env:TEMP 'dockvision-dockv333-pytest-env'
& (Join-Path $envDir 'Scripts\\python.exe') -m pytest -q <temporary-comparison-module>.py
```

The temporary pytest module was removed after comparison, so pytest is not a
repository-visible test dependency. The recorded comparison used pytest 9.2.0
in a Python 3.10 virtual environment and completed in under one second after
environment creation.

Run the established lifecycle suite with:

```powershell
npm run test:vm-agent
```

These tests do not execute uploaded scripts, launch Notepad, inject keyboard or
mouse input, start Docker, or delete live VM storage.

## Acceptance-criteria mapping

| Criterion | Evidence | Status |
| --- | --- | --- |
| Inventory lifecycle tests and runtime copy | Existing test suite, deployment test, source/deployed hash comparison | Complete; repository copies reconciled |
| Compare `unittest` and `pytest` | Equivalent three-case samples run in the repository interpreter and disposable pytest environment | Complete for host-safe cases; guest GUI equivalence remains unverified |
| Define lifecycle, duplicate claim, failure/cancellation/timeout, cleanup, artifact, heartbeat cases | Existing 34-test suite inventory, focused samples, and runner cleanup seam | Complete for host-safe boundaries |
| Demonstrate success, controlled failure, cancellation/timeout | Focused samples plus existing timeout tests | Complete for host-safe boundaries |
| Provide authorized guest-only checklist | Checklist below | Complete as an unexecuted operational procedure |
| Document recommendation, tradeoffs, commands, results, target, and gaps | This document | Complete |

## Authorized guest-only checklist

These checks are not run on the development host and are not claimed as
automated coverage:

1. Confirm the authorized Windows VM has the intended deployed runner bytes and
   the expected Python runtime/dependencies.
2. Use inert built-in fixtures only; do not upload or execute arbitrary scripts.
3. Run a successful Notepad task and record the run ID, terminal result, task
   status, heartbeat status, heartbeat `runId`, and owned process state.
4. Run a controlled built-in failure and verify a terminal failure result,
   preserved diagnostics, process cleanup, and an idle heartbeat.
5. Request cancellation or allow the configured timeout and verify terminal
   cancellation/failure, owned-window cleanup, and no repeat execution.
6. Exercise the real KEY behavior only after DOCKV-326 defines the accepted key
   vocabulary; record the key, target window, observed effect, and result.
7. Run inert fixtures sequentially and verify the next run is admitted only
   after the previous result is terminal, active metadata/pointer is consistent,
   and the heartbeat is fresh and idle.
8. Preserve unrelated windows, active pointers, run artifacts, and other users'
   data. Do not reset, rebuild, or delete VM resources as part of routine
   verification.

## Results and remaining gaps

Baseline result on the current branch:

```text
npm run test:vm-agent
Ran 34 tests
OK
```

Focused unittest sample result:

```text
python -m unittest -v tests/vm_agent_lifecycle_sample_test.py
Ran 4 tests
OK
```

Disposable pytest comparison result:

```text
pytest 9.2.0
3 passed in 0.21s
```

Failure-diagnostics check: a temporary test containing an intentionally false
assertion returned pytest exit code 1 with a failure report. The temporary file
was removed afterward; no failing test remains in the repository.

Repository source and deployment-bundle equivalence is verified. The installed
guest runner and real GUI behavior remain unverified until an authorized guest
check confirms the installed hash and exercises the Windows lifecycle.

## References

- `tests/vm_agent_lifecycle_test.py`
- `tests/vm_agent_lifecycle_sample_test.py`
- `server/test/windowsVmRuntime.test.js`
- `docs/pywinauto-vm-notepad-demo/vm-notepad-runner.py`
- `WindowsVm/shared/vm-notepad-runner.py`
- `WindowsVm/shared/install-agent.bat`
- `docs/run-launch-contract.md`
- Python `unittest` documentation: https://docs.python.org/3/library/unittest.html
- pytest documentation: https://docs.pytest.org/en/stable/
- pywinauto documentation: https://pywinauto.readthedocs.io/en/latest/
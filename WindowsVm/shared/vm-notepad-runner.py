#!/usr/bin/env python3
"""
DockVision VM pywinauto/UI Automation named-control demo.

Purpose:
- Prove a CLICK contract where the user chooses a named target such as
  "notepad.editor" instead of typing raw screen coordinates.
- Resolve that named target through pywinauto's UI Automation backend inside
  the DockVision Windows VM.
- Click a precise point inside the resolved control using x/y percentages.
- Write a control-tree artifact so the team can discover more named targets.

Sequential flow:
1. Read task-plan.json.
2. Launch Notepad against a fresh timestamped file before user tasks run.
3. Move the Notepad window to a predictable place for repeatable demos.
4. Automatically dump the UI Automation control tree to artifacts/control-tree.txt.
5. Execute only the user-facing tasks listed in task-plan.json.
6. Resolve CLICK target names such as "fileMenu" by scanning controls.
7. Convert the resolved control rectangle plus x/y percentages into a click point.
8. Send mouse, keyboard, and typing actions through pywinauto.
9. Write artifacts/result.json so teammates can see exactly what happened.

Key idea:
- task-plan.json describes intent: "click fileMenu".
- runner.py owns VM classic-Notepad UIA clues: title "File", controlType "MenuItem".
- runner.py turns those clues into an actual control and screen coordinate.

This VM-focused copy intentionally lives beside, not on top of, the desktop demo.
Classic VM Notepad exposes File/Edit/Format/View/Help menu items and an Edit
control, but it does not expose the newer Bold/Italic toolbar controls.
"""

from __future__ import annotations

import argparse
import ctypes
import getpass
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Any, Callable


# The demo is intentionally self-contained. All relative files, generated
# Notepad documents, and artifacts live beside this runner.
SCRIPT_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = SCRIPT_DIR / "artifacts"

# Agent transport contract. These values preserve the existing shared-folder
# and heartbeat schema while this Python file runs the VM agent.
AGENT_NAME = "DockVision Guest Agent"
AGENT_VERSION = "0.5.2"
HEARTBEAT_INTERVAL_SECONDS = 15
SHARED_ROOT_CANDIDATES = (
    Path(r"\\host.lan\Data"),
    Path(r"C:\Users\Docker\Desktop\Shared"),
    Path(r"C:\Users\Public\Desktop\Shared"),
)
SHARED_ROOT_FALLBACK = Path(r"C:\DockVision\shared-fallback")

# Internal app-specific target registry for the DockVision Windows VM.
#
# The VM currently runs classic Windows Notepad. Its UIA tree exposes the text
# editor plus File/Edit/Format/View/Help menu items, but it does not expose the
# Windows 11 Notepad formatting toolbar used by the desktop demo. This registry
# intentionally sticks to controls observed in the VM control tree so uploaded
# plans can run inside the guest consistently.
NOTEPAD_TARGETS: dict[str, dict[str, Any]] = {
    "editor": {
        "description": "The classic Notepad text editor surface",
        "candidates": [
            {"title": "Text Editor", "controlType": "Edit"},
            {"controlType": "Document"},
            {"controlType": "Edit"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
    "fileMenu": {
        "description": "The File menu in Notepad",
        "candidates": [
            {"title": "File", "controlType": "MenuItem"},
            {"title": "File"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
    "editMenu": {
        "description": "The Edit menu in Notepad",
        "candidates": [
            {"title": "Edit", "controlType": "MenuItem"},
            {"title": "Edit"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
    "formatMenu": {
        "description": "The Format menu in classic Notepad",
        "candidates": [
            {"title": "Format", "controlType": "MenuItem"},
            {"title": "Format"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
    "viewMenu": {
        "description": "The View menu in Notepad",
        "candidates": [
            {"title": "View", "controlType": "MenuItem"},
            {"title": "View"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
    "helpMenu": {
        "description": "The Help menu in classic Notepad",
        "candidates": [
            {"title": "Help", "controlType": "MenuItem"},
            {"title": "Help"},
        ],
        "defaultPoint": {"xPercent": 50, "yPercent": 50},
    },
}

# Backward-compatible aliases help old demo plans keep working while the new
# user-facing contract uses shorter names like "editor" and "fileMenu".
NOTEPAD_TARGETS["notepad.editor"] = NOTEPAD_TARGETS["editor"]
NOTEPAD_TARGETS["notepad.fileMenu"] = NOTEPAD_TARGETS["fileMenu"]
NOTEPAD_TARGETS["notepad.editMenu"] = NOTEPAD_TARGETS["editMenu"]
NOTEPAD_TARGETS["notepad.formatMenu"] = NOTEPAD_TARGETS["formatMenu"]
NOTEPAD_TARGETS["notepad.viewMenu"] = NOTEPAD_TARGETS["viewMenu"]
NOTEPAD_TARGETS["notepad.helpMenu"] = NOTEPAD_TARGETS["helpMenu"]


# Load task-plan.json from disk. This is the first boundary between the planned
# frontend-generated task list and the runner that executes it.
def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        raw = handle.read().strip()
    return json.loads(raw) if raw else {}


# Persist result.json in a readable format. This lets teammates verify each
# resolved control, click point, and completed step after the demo finishes.
def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)


def write_json_atomically(path: Path, value: dict[str, Any]) -> None:
    """Publish JSON by replacement so readers do not observe a partial file."""

    # write a complete temporary file first, then replace the public file in one step
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary_path.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink(missing_ok=True)


def utc_timestamp() -> str:
    """Return the ISO-8601 UTC representation used by agent-facing files."""

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_shared_root(
    candidates: tuple[Path, ...] = SHARED_ROOT_CANDIDATES,
    fallback: Path = SHARED_ROOT_FALLBACK,
) -> Path:
    """Find the guest/host share using the established DockVision path order."""

    # use the first mounted share that exists, and create a local fallback only when none do
    for candidate in candidates:
        if candidate.is_dir():
            return candidate

    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def agent_paths(shared_root: Path) -> dict[str, Path]:
    """Return the shared transport paths owned by the long-running agent."""

    return {
        "sharedRoot": shared_root,
        "activeRoot": shared_root / "active",
        "runsRoot": shared_root / "runs",
        "heartbeatPath": shared_root / "agent-heartbeat.json",
        "installLogPath": shared_root / "agent-install-log.txt",
        "currentRunPointerPath": shared_root / "active" / "current-run.json",
    }


def ensure_agent_shared_layout(shared_root: Path) -> dict[str, Path]:
    """Create only the durable shared transport directories required by the agent."""

    # create the common, active-channel, and run-history folders before writing agent files
    paths = agent_paths(shared_root)
    for key in ("sharedRoot", "activeRoot", "runsRoot"):
        paths[key].mkdir(parents=True, exist_ok=True)
    return paths


def append_agent_install_log(shared_root: Path, message: str) -> None:
    """Append an agent diagnostic without coupling it to run-specific logging."""

    paths = ensure_agent_shared_layout(shared_root)
    with paths["installLogPath"].open("a", encoding="utf-8") as handle:
        handle.write(f"[{utc_timestamp()}] {message}\n")


def build_agent_heartbeat(
    shared_root: Path,
    status: str = "idle",
    task_name: str = "waiting_for_task",
    run_id: str = "",
) -> dict[str, Any]:
    """Build the heartbeat schema consumed by server/lib/guestReadiness.js."""

    # keep the agent state and machine details together in the file read by guest readiness checks
    return {
        "agent": {
            "name": AGENT_NAME,
            "version": AGENT_VERSION,
            "status": status,
            "taskName": task_name,
            "runId": run_id,
            "intervalSeconds": HEARTBEAT_INTERVAL_SECONDS,
        },
        "machine": {
            "computerName": socket.gethostname(),
            "username": getpass.getuser(),
            "timestampUtc": utc_timestamp(),
            "sharedRoot": str(shared_root),
            "platform": platform.platform(),
        },
        "prototype": {
            "notes": [
                "Guest agent is running inside the Windows VM.",
                "Shared folder was detected successfully.",
                "Heartbeat is being written on a recurring loop.",
            ]
        },
    }


def write_agent_heartbeat(
    shared_root: Path,
    status: str = "idle",
    task_name: str = "waiting_for_task",
    run_id: str = "",
) -> None:
    """Write a fresh agent heartbeat to the shared-root contract location."""

    # reuse the shared layout and atomic writer so the server never reads a half-written heartbeat
    paths = ensure_agent_shared_layout(shared_root)
    write_json_atomically(
        paths["heartbeatPath"],
        build_agent_heartbeat(shared_root, status=status, task_name=task_name, run_id=run_id),
    )


def read_json_if_present(path: Path) -> dict[str, Any] | None:
    """Read an optional JSON object; reject empty, scalar, and array payloads."""

    # a missing or blank optional file means there is no active value to process
    if not path.is_file():
        return None

    with path.open("r", encoding="utf-8-sig") as handle:
        raw = handle.read().strip()

    if not raw:
        return None

    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return value


def path_within(path: Path, parent: Path) -> bool:
    """Return whether a normalized path is contained by the normalized parent."""

    try:
        path.resolve(strict=False).relative_to(parent.resolve(strict=False))
        return True
    except ValueError:
        return False


def require_path_within(path: Path, parent: Path, description: str) -> Path:
    """Normalize a path and reject values that escape the expected directory."""

    resolved_path = path.resolve(strict=False)
    if not path_within(resolved_path, parent):
        raise ValueError(f"{description} is outside the active run folder: {path}")
    return resolved_path


def get_run_context(shared_root: Path, run_id: str) -> dict[str, Path | str]:
    """Build the default filesystem contract for one validated active run."""

    # validate the host-provided ID before using it to construct any filesystem path
    if not re.fullmatch(r"run-[A-Za-z0-9-]+", run_id):
        raise ValueError(f"Active run pointer has an invalid runId: {run_id!r}")

    paths = ensure_agent_shared_layout(shared_root)
    run_root = require_path_within(paths["runsRoot"] / run_id, paths["runsRoot"], "Run root")
    logs_root = run_root / "logs"
    return {
        "runId": run_id,
        "runRoot": run_root,
        "metaPath": run_root / "meta.json",
        "taskPath": run_root / "task.json",
        "resultPath": run_root / "result.json",
        "logsRoot": logs_root,
        "taskLogPath": logs_root / "task.log",
        "screenshotsRoot": run_root / "screenshots",
        "artifactsRoot": run_root / "artifacts",
        "cancelRequestPath": run_root / "cancel-request.json",
        "cancelMarkerPath": run_root / "cancel.json",
    }


def resolve_active_channel_path(
    shared_root: Path,
    run_context: dict[str, Path | str],
    path_value: Any,
    description: str,
) -> Path:
    """Resolve a pointer channel path while constraining it to its active run."""

    if not isinstance(path_value, str) or not path_value.strip():
        raise ValueError(f"Active pointer {description} must be a non-empty string.")

    candidate = Path(path_value)
    if not candidate.is_absolute():
        candidate = shared_root / candidate
    return require_path_within(candidate, Path(run_context["runRoot"]), description)


def read_current_run_pointer(shared_root: Path) -> dict[str, Any] | None:
    """Read the host-published active-run pointer without changing its state."""

    pointer_path = agent_paths(shared_root)["currentRunPointerPath"]
    try:
        return read_json_if_present(pointer_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        append_agent_install_log(shared_root, f"Failed to parse current run pointer: {exc}")
        return None


def resolve_active_run_context(shared_root: Path) -> dict[str, Path | str] | None:
    """Resolve the current pointer into validated paths for its one active run."""

    pointer = read_current_run_pointer(shared_root)
    if pointer is None:
        return None

    run_id = pointer.get("runId")
    if not isinstance(run_id, str) or not run_id.strip():
        append_agent_install_log(shared_root, "Active run pointer did not contain a usable runId.")
        return None

    try:
        context = get_run_context(shared_root, run_id)
        channel = pointer.get("channel")
        if channel is not None:
            if not isinstance(channel, dict):
                raise ValueError("Active run pointer channel must be a JSON object.")

            channel_paths = {
                "taskPath": "taskPath",
                "resultPath": "resultPath",
                "logsDir": "logsRoot",
                "screenshotsDir": "screenshotsRoot",
                "artifactsDir": "artifactsRoot",
            }
            for channel_key, context_key in channel_paths.items():
                if channel_key in channel and channel[channel_key] is not None:
                    context[context_key] = resolve_active_channel_path(
                        shared_root,
                        context,
                        channel[channel_key],
                        f"Active pointer channel.{channel_key}",
                    )

            context["taskLogPath"] = Path(context["logsRoot"]) / "task.log"

        return context
    except (OSError, ValueError) as exc:
        append_agent_install_log(shared_root, f"Failed to resolve active run context: {exc}")
        return None


def read_active_task(shared_root: Path) -> tuple[dict[str, Path | str], dict[str, Any]] | None:
    """Read the task addressed by the active pointer and normalize its run ID."""

    context = resolve_active_run_context(shared_root)
    if context is None:
        return None

    try:
        task = read_json_if_present(Path(context["taskPath"]))
        if task is None:
            return None
        task.setdefault("runId", context["runId"])
        if task["runId"] != context["runId"]:
            raise ValueError("Active task runId does not match current-run.json.")
        return context, task
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        append_agent_install_log(shared_root, f"Failed to parse active task file: {exc}")
        return None


def is_run_cancellation_requested(run_context: dict[str, Path | str], shared_root: Path) -> bool:
    """Return true for either supported run-scoped cancellation marker."""

    try:
        request = read_json_if_present(Path(run_context["cancelRequestPath"]))
        if request is not None and request.get("status") == "requested":
            return True

        # The established PowerShell contract uses cancel-request.json. The
        # current /cancel2 backend endpoint also writes cancel.json, whose
        # runId is required to match the already validated active run context.
        marker = read_json_if_present(Path(run_context["cancelMarkerPath"]))
        return marker is not None and marker.get("runId") == run_context["runId"]
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        append_agent_install_log(shared_root, f"Cancellation marker could not be read: {exc}")
        return False


class AgentTaskCancelled(RuntimeError):
    """Signal a supported cancellation outcome to the task lifecycle boundary."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class AgentTaskTimedOut(RuntimeError):
    """Signal a configured iteration timeout to the task lifecycle boundary."""


    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class AgentTaskExecutionError(RuntimeError):
    """Expose runner diagnostics to the lifecycle failure result formatter."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


AGENT_TERMINAL_TASK_STATUSES = {"completed", "failed", "cancelled"}


def configured_iteration_timeout_seconds(task: dict[str, Any]) -> int:
    """Read the backend's per-iteration deadline, separate from plan UIA timeouts."""

    options = task.get("runOptions")
    if not isinstance(options, dict):
        options = task.get("settings")
    value = options.get("iterationTimeoutSeconds") if isinstance(options, dict) else None
    return max(int_value(value, 300), 1)


def make_execution_abort_check(
    run_context: dict[str, Path | str], task: dict[str, Any], shared_root: Path
) -> Callable[[], None]:
    """Build a cooperative cancellation and configured-deadline checkpoint."""

    timeout_seconds = configured_iteration_timeout_seconds(task)
    deadline = time.monotonic() + timeout_seconds

    def check() -> None:
        if is_run_cancellation_requested(run_context, shared_root):
            raise AgentTaskCancelled("Cancellation was requested while task execution was active.")
        if time.monotonic() >= deadline:
            raise AgentTaskTimedOut(
                f"Task exceeded its configured iteration timeout of {timeout_seconds} seconds."
            )

    return check


def terminate_child_process_tree(process: subprocess.Popen[Any], grace_seconds: float = 5.0) -> bool:
    """Terminate a future custom-runner process tree without leaking descendants."""

    if process.poll() is not None:
        return True
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=max(grace_seconds, 1.0),
            )
        else:
            process.terminate()
        process.wait(timeout=max(grace_seconds, 0.1))
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
            process.wait(timeout=max(grace_seconds, 0.1))
        except (OSError, subprocess.TimeoutExpired):
            return False
    return process.poll() is not None


def ensure_run_output_layout(run_context: dict[str, Path | str]) -> None:
    """Create the active run's output directories before publishing lifecycle files."""

    for context_key in ("runRoot", "logsRoot", "screenshotsRoot", "artifactsRoot"):
        Path(run_context[context_key]).mkdir(parents=True, exist_ok=True)


def append_run_log(run_context: dict[str, Path | str], message: str) -> None:
    """Append a timestamped diagnostic to the active run's task log."""

    ensure_run_output_layout(run_context)
    with Path(run_context["taskLogPath"]).open("a", encoding="utf-8") as handle:
        handle.write(f"[{utc_timestamp()}] {message}\n")


def write_active_task(run_context: dict[str, Path | str], task: dict[str, Any]) -> None:
    """Atomically publish task status changes to the active channel task path."""

    ensure_run_output_layout(run_context)
    write_json_atomically(Path(run_context["taskPath"]), task)


def write_active_result(run_context: dict[str, Path | str], result: dict[str, Any]) -> None:
    """Atomically publish a terminal result to the active channel result path."""

    ensure_run_output_layout(run_context)
    write_json_atomically(Path(run_context["resultPath"]), result)


def mark_active_task_running(run_context: dict[str, Path | str], task: dict[str, Any]) -> None:
    """Persist the queued-to-running transition before task execution begins."""

    task["status"] = "running"
    task["startedUtc"] = utc_timestamp()
    write_active_task(run_context, task)


def mark_active_task_finished(
    run_context: dict[str, Path | str], task: dict[str, Any], status: str
) -> None:
    """Persist a backend-supported terminal task state and completion timestamp."""

    if status not in AGENT_TERMINAL_TASK_STATUSES:
        raise ValueError(f"Unsupported terminal task status: {status!r}")

    task["status"] = status
    task["completedUtc"] = utc_timestamp()
    write_active_task(run_context, task)


def build_active_result(
    run_context: dict[str, Path | str],
    task: dict[str, Any],
    status: str,
    message: str,
    execution_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize a task outcome to the result.json contract used by the backend."""

    if status not in AGENT_TERMINAL_TASK_STATUSES:
        raise ValueError(f"Unsupported terminal result status: {status!r}")

    execution_result = execution_result or {}
    artifacts = execution_result.get("artifacts")
    details = execution_result.get("details")
    reserved_fields = {"runId", "taskId", "status", "finishedUtc", "message", "artifacts", "details"}
    additional_details = {
        key: value for key, value in execution_result.items() if key not in reserved_fields
    }

    if not isinstance(artifacts, dict):
        artifacts = {}
    if not isinstance(details, dict):
        details = {}
    if additional_details:
        details = {**details, **additional_details}

    result: dict[str, Any] = {
        "runId": run_context["runId"],
        "taskId": str(task.get("taskId") or "unknown-task"),
        "status": status,
        "finishedUtc": utc_timestamp(),
        "message": message,
        "artifacts": artifacts,
    }
    if details:
        result["details"] = details
    return result


def execute_agent_task(
    run_context: dict[str, Path | str], task: dict[str, Any], shared_root: Path
) -> dict[str, Any]:
    """Dispatch implemented agent workloads without accepting unsupported work."""

    # check cancellation before selecting a workload so cancelled runs never start UI or child processes
    if is_run_cancellation_requested(run_context, shared_root):
        raise AgentTaskCancelled("Cancellation was requested before task execution began.")

    abort_check = make_execution_abort_check(run_context, task, shared_root)
    abort_check()

    # route each supported task type to its isolated execution path
    task_type = str(task.get("taskType") or "unknown")
    if task_type == "noop":
        return {
            "status": "completed",
            "message": "No-op task completed.",
            "artifacts": {},
            "details": {"taskType": task_type},
        }

    if task_type == "task_sequence":
        return execute_task_sequence_task(run_context, task, abort_check=abort_check)

    if task_type == "script_runner":
        return execute_script_runner_task(run_context, task, shared_root)

    raise RuntimeError(f"Task type '{task_type}' execution is not configured yet.")


def read_task_sequence_plan(run_context: dict[str, Path | str], task: dict[str, Any]) -> dict[str, Any]:
    """Read a built-in plan from its normalized payload or active run task-plan file."""

    # prefer the server-normalized payload, then support older runs that stored task-plan.json
    payload = task.get("payload")
    if isinstance(payload, dict):
        return payload

    plan_path = Path(run_context["runRoot"]) / "task-plan.json"
    try:
        plan = read_json(plan_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read built-in task plan at '{plan_path}': {exc}") from exc

    if not isinstance(plan, dict):
        raise RuntimeError(f"Built-in task plan at '{plan_path}' must be a JSON object.")
    return plan


def execute_task_sequence_task(
    run_context: dict[str, Path | str],
    task: dict[str, Any],
    abort_check: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Run one normalized built-in Notepad plan in the active run directories."""

    # give the Notepad worker only paths that belong to this run so its artifacts stay isolated
    plan = read_task_sequence_plan(run_context, task)
    task_id = str(task.get("taskId") or "unknown-task")
    execution = dispatch_builtin_notepad_task(
        plan,
        artifact_dir=Path(run_context["artifactsRoot"]),
        artifact_relative_root=Path(run_context["runRoot"]),
        file_dir=Path(run_context["artifactsRoot"]),
        screenshot_dir=Path(run_context["screenshotsRoot"]),
        screenshot_name=f"notepad-{task_id}.png",
        capture_screenshot=bool_value(plan.get("captureScreenshot"), True),
        abort_check=abort_check,
    )
    # summarize the worker's detailed steps into the result fields used by the backend and UI
    steps = execution.get("steps")
    if not isinstance(steps, list):
        steps = []

    typed_steps = [step for step in steps if isinstance(step, dict) and step.get("action") == "TYPE"]
    clicked_steps = [step for step in steps if isinstance(step, dict) and step.get("action") == "CLICK"]
    details: dict[str, Any] = {
        "taskType": "task_sequence",
        "automationBackend": execution.get("automationBackend", "python-pywinauto-uia"),
        "planName": execution.get("planName"),
        "totalStepCount": len(steps),
        "typedStepCount": len(typed_steps),
        "clickedStepCount": len(clicked_steps),
        "typedCharacterCount": sum(int_value(step.get("typedCharacterCount"), 0) for step in typed_steps),
        "steps": steps,
        "startup": execution.get("startup"),
        "openedFile": execution.get("openedFile"),
    }
    if execution.get("screenshotWarning"):
        details["screenshotWarning"] = execution["screenshotWarning"]

    return {
        "status": "completed",
        "message": (
            f"Completed {len(typed_steps)} TYPE and {len(clicked_steps)} CLICK task(s) "
            "through Python UI automation."
        ),
        "artifacts": execution.get("artifacts") if isinstance(execution.get("artifacts"), dict) else {},
        "details": details,
    }


def execute_script_runner_task(
    run_context: dict[str, Path | str], task: dict[str, Any], shared_root: Path
) -> dict[str, Any]:
    """Launch and supervise one uploaded Python or PowerShell runner process."""

    # validate the uploaded paths and build the language-specific command before starting a child process
    language, runner_path, config_path = resolve_custom_runner_inputs(run_context, task)
    task_id = str(task.get("taskId") or "unknown-task")
    command = custom_runner_command(language, runner_path, config_path)
    ensure_run_output_layout(run_context)

    stdout_path = Path(run_context["logsRoot"]) / f"{task_id}-stdout.txt"
    stderr_path = Path(run_context["logsRoot"]) / f"{task_id}-stderr.txt"
    started_utc = utc_timestamp()
    started_monotonic = time.monotonic()
    timeout_seconds = configured_iteration_timeout_seconds(task)
    capture_interval_seconds = configured_capture_interval_seconds(task)
    next_capture = started_monotonic + capture_interval_seconds
    process: subprocess.Popen[Any] | None = None
    screenshot_paths: list[str] = []
    screenshot_warnings: list[str] = []

    append_run_log(run_context, f"Executing uploaded {language} runner: {runner_path}")
    append_run_log(
        run_context,
        f"Worker supervision settings: timeout={timeout_seconds}s, capture interval={capture_interval_seconds:g}s.",
    )
    try:
        with stdout_path.open("wb") as stdout_handle, stderr_path.open("wb") as stderr_handle:
            process = subprocess.Popen(
                command,
                cwd=str(Path(run_context["runRoot"])),
                stdout=stdout_handle,
                stderr=stderr_handle,
            )
            append_run_log(run_context, f"Worker process started with PID {process.pid}.")

            # supervise the child until it exits, checking cancellation, timeout, and screenshot capture
            while process.poll() is None:
                now_monotonic = time.monotonic()
                if is_run_cancellation_requested(run_context, shared_root):
                    append_run_log(run_context, f"Cancellation requested. Terminating worker PID {process.pid}.")
                    terminated = terminate_child_process_tree(process)
                    raise AgentTaskCancelled(
                        "Run was cancelled.",
                        {
                            "process": build_custom_runner_process_details(
                                language,
                                runner_path,
                                config_path,
                                run_context,
                                process,
                                started_utc,
                                stdout_path,
                                stderr_path,
                                terminated=terminated,
                            )
                        },
                    )
                if now_monotonic - started_monotonic >= timeout_seconds:
                    append_run_log(
                        run_context,
                        f"Worker PID {process.pid} exceeded iteration timeout of {timeout_seconds}s.",
                    )
                    terminated = terminate_child_process_tree(process)
                    raise AgentTaskTimedOut(
                        f"Uploaded runner exceeded iteration timeout of {timeout_seconds}s.",
                        {
                            "process": build_custom_runner_process_details(
                                language,
                                runner_path,
                                config_path,
                                run_context,
                                process,
                                started_utc,
                                stdout_path,
                                stderr_path,
                                terminated=terminated,
                            )
                        },
                    )
                if now_monotonic >= next_capture:
                    capture_name = f"{task_id}-{timestamp()}.png"
                    try:
                        capture_path = capture_custom_runner_screenshot(run_context, task_id, capture_name)
                        screenshot_paths.append(capture_path)
                        append_run_log(run_context, f"Captured periodic screenshot: {capture_path}")
                    except Exception as exc:
                        warning = f"Periodic screenshot capture unavailable: {exc}"
                        screenshot_warnings.append(warning)
                        append_run_log(run_context, warning)
                    next_capture = now_monotonic + capture_interval_seconds
                time.sleep(0.25)

            exit_code = process.wait()
    except Exception:
        if process is not None and process.poll() is None:
            terminate_child_process_tree(process)
        raise

    # the child exited normally, so record completion details and make one final best-effort screenshot
    completed_utc = utc_timestamp()
    try:
        capture_path = capture_custom_runner_screenshot(
            run_context, task_id, f"{task_id}-complete-{timestamp()}.png"
        )
        screenshot_paths.append(capture_path)
        append_run_log(run_context, f"Captured completion screenshot: {capture_path}")
    except Exception as exc:
        warning = f"Completion screenshot capture unavailable: {exc}"
        screenshot_warnings.append(warning)
        append_run_log(run_context, warning)

    stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace").strip()
    stderr_text = stderr_path.read_text(encoding="utf-8", errors="replace").strip()
    process_details = build_custom_runner_process_details(
        language,
        runner_path,
        config_path,
        run_context,
        process,
        started_utc,
        stdout_path,
        stderr_path,
        exit_code=exit_code,
        completed_utc=completed_utc,
    )
    # a non-zero process or invalid result contract is a terminal agent failure, not a successful run
    if exit_code != 0:
        raise AgentTaskExecutionError(
            f"Uploaded runner failed with exit code {exit_code}. {stderr_text} {stdout_text}".strip(),
            {"process": process_details},
        )

    try:
        runner_result = parse_runner_output_json(stdout_text)
    except (ValueError, json.JSONDecodeError) as exc:
        raise AgentTaskExecutionError(
            f"Uploaded runner completed but did not return valid JSON. Output: {stdout_text}",
            {"process": process_details},
        ) from exc

    runner_status = runner_result.get("status")
    if runner_status is not None and str(runner_status).casefold() != "completed":
        raise AgentTaskExecutionError(
            f"Uploaded runner reported status '{runner_status}'.", {"process": process_details}
        )

    artifacts = runner_result.get("artifacts")
    if artifacts is None:
        artifacts = {}
    if not isinstance(artifacts, dict):
        raise AgentTaskExecutionError(
            "Uploaded runner result artifacts must be an object.", {"process": process_details}
        )
    runner_details = runner_result.get("details")
    if runner_details is None:
        runner_details = {}
    if not isinstance(runner_details, dict):
        raise AgentTaskExecutionError(
            "Uploaded runner result details must be an object.", {"process": process_details}
        )
    result_artifacts = dict(artifacts)
    if screenshot_paths:
        result_artifacts["screenshots"] = screenshot_paths
        result_artifacts["screenshot"] = screenshot_paths[-1]
    result_details = {**runner_details, "taskType": "script_runner", "process": process_details}
    if screenshot_warnings:
        result_details["screenshotWarnings"] = screenshot_warnings
    append_run_log(run_context, f"Worker process PID {process.pid} completed with exit code {exit_code}.")
    return {
        "status": "completed",
        "message": str(runner_result.get("message") or "Uploaded runner completed."),
        "artifacts": result_artifacts,
        "details": result_details,
    }


def build_custom_runner_process_details(
    language: str,
    runner_path: Path,
    config_path: Path,
    run_context: dict[str, Path | str],
    process: subprocess.Popen[Any],
    started_utc: str,
    stdout_path: Path,
    stderr_path: Path,
    *,
    exit_code: int | None = None,
    completed_utc: str | None = None,
    terminated: bool | None = None,
) -> dict[str, Any]:
    """Build result-safe runner diagnostics from run-confined log files."""

    # report only paths relative to the active run so host file locations are not exposed in results
    run_root = Path(run_context["runRoot"])
    details: dict[str, Any] = {
        "language": language,
        "runnerPath": str(runner_path.relative_to(run_root)).replace("\\", "/"),
        "configPath": str(config_path.relative_to(run_root)).replace("\\", "/"),
        "processId": process.pid,
        "startedUtc": started_utc,
        "stdoutPath": str(stdout_path.relative_to(run_root)).replace("\\", "/"),
        "stderrPath": str(stderr_path.relative_to(run_root)).replace("\\", "/"),
    }
    if exit_code is not None:
        details["exitCode"] = exit_code
    if completed_utc is not None:
        details["completedUtc"] = completed_utc
    if terminated is not None:
        details["processTreeTerminated"] = terminated
    if stderr_path.is_file():
        stderr_text = stderr_path.read_text(encoding="utf-8", errors="replace").strip()
        if stderr_text:
            details["stderr"] = stderr_text
    return details


def process_queued_active_task(
    shared_root: Path,
    executor: Callable[[dict[str, Path | str], dict[str, Any], Path], dict[str, Any]] = execute_agent_task,
) -> bool:
    """Process one queued active task and always publish a terminal outcome.

    Returns true only when this call claimed a queued task. The caller may use the
    return value for polling diagnostics; terminal and non-queued tasks are never
    executed again.
    """

    # read and claim only one queued task; missing, malformed, and terminal tasks are left alone
    active_task = read_active_task(shared_root)
    if active_task is None:
        return False

    run_context, task = active_task
    if task.get("status") != "queued":
        return False

    task_id = str(task.get("taskId") or "unknown-task")
    task_type = str(task.get("taskType") or "unknown")
    append_agent_install_log(
        shared_root, f"Handling task '{task_id}' of type '{task_type}' for run '{run_context['runId']}'."
    )
    # publish running state before execution so the server can observe that the agent owns this task
    mark_active_task_running(run_context, task)
    write_agent_heartbeat(shared_root, status="running", task_name=task_type, run_id=str(run_context["runId"]))
    append_run_log(run_context, f"Task '{task_id}' started ({task_type}).")

    final_status = "failed"
    result: dict[str, Any]
    # convert every execution outcome into a supported terminal result without stopping the agent loop
    try:
        if is_run_cancellation_requested(run_context, shared_root):
            raise AgentTaskCancelled("Cancellation was requested before task execution began.")

        execution_result = executor(run_context, task, shared_root)
        requested_status = str(execution_result.get("status") or "completed").lower()
        if requested_status not in AGENT_TERMINAL_TASK_STATUSES:
            raise RuntimeError(f"Task executor returned unsupported terminal status '{requested_status}'.")

        final_status = requested_status
        message = str(execution_result.get("message") or "Task completed.")
        result = build_active_result(run_context, task, final_status, message, execution_result)
    except AgentTaskCancelled as exc:
        final_status = "cancelled"
        result = build_active_result(run_context, task, final_status, str(exc), {"details": exc.details})
        append_agent_install_log(shared_root, f"Task '{task_id}' cancelled: {exc}")
    except AgentTaskTimedOut as exc:
        final_status = "failed"
        result = build_active_result(
            run_context,
            task,
            final_status,
            str(exc),
            {"details": {"errorType": type(exc).__name__, "timedOut": True, **exc.details}},
        )
        append_agent_install_log(shared_root, f"Task '{task_id}' timed out: {exc}")
    except Exception as exc:
        final_status = "failed"
        failure_details = {"errorType": type(exc).__name__}
        if isinstance(exc, AgentTaskExecutionError):
            failure_details.update(exc.details)
        result = build_active_result(
            run_context,
            task,
            final_status,
            str(exc),
            {"details": failure_details},
        )
        append_agent_install_log(shared_root, f"Task '{task_id}' failed: {exc}")
    finally:
        # always publish the result, terminal task state, and idle heartbeat even after an exception
        try:
            write_active_result(run_context, result)
            mark_active_task_finished(run_context, task, final_status)
            append_run_log(run_context, f"Task '{task_id}' finished with status '{final_status}'.")
        finally:
            write_agent_heartbeat(shared_root, status="idle", task_name="waiting_for_task")

    return True


def resolve_run_relative_path(run_context: dict[str, Path | str], path_value: str) -> Path:
    """Resolve an uploaded runner/config path and confine it to the active run."""

    if not path_value or not path_value.strip():
        raise ValueError("Run-relative path must be a non-empty string.")

    candidate = Path(path_value)
    if not candidate.is_absolute():
        candidate = Path(run_context["runRoot"]) / candidate
    return require_path_within(candidate, Path(run_context["runRoot"]), "Resolved path")


# Convert loose JSON input into a real bool. This keeps the runner forgiving if
# future UI code sends "true" as a string instead of true as a JSON boolean.
def bool_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


# Convert loose JSON input into an int while preserving a safe default.
def int_value(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# Convert loose JSON input into a float for percent-based click positions.
def float_value(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def configured_capture_interval_seconds(task: dict[str, Any]) -> float:
    """Read the server's periodic screenshot interval with a safe default."""

    options = task.get("runOptions")
    value = options.get("captureIntervalSeconds") if isinstance(options, dict) else None
    return max(float_value(value, 5.0), 0.1)


def capture_custom_runner_screenshot(
    run_context: dict[str, Path | str], task_id: str, file_name: str
) -> str:
    """Capture a best-effort screen artifact for an externally supervised runner."""

    from PIL import ImageGrab

    ensure_run_output_layout(run_context)
    screenshot_path = require_path_within(
        Path(run_context["screenshotsRoot"]) / file_name,
        Path(run_context["runRoot"]),
        "Custom runner screenshot",
    )
    ImageGrab.grab().save(screenshot_path, "PNG")
    return str(screenshot_path.relative_to(Path(run_context["runRoot"]))).replace("\\", "/")


def parse_runner_output_json(output_text: str) -> dict[str, Any]:
    """Mirror ConvertFrom-RunnerOutputJson's brace-delimited JSON behavior."""

    # ignore ordinary runner logging around the first complete JSON object returned on stdout
    if not output_text or not output_text.strip():
        raise ValueError("Runner produced no output.")

    start_index = output_text.find("{")
    end_index = output_text.rfind("}")
    if start_index < 0 or end_index < start_index:
        raise ValueError(f"Runner output did not contain a JSON object. Output: {output_text}")

    result = json.loads(output_text[start_index : end_index + 1])
    if not isinstance(result, dict):
        raise ValueError("Runner output JSON must be an object.")
    return result


def resolve_custom_runner_inputs(
    run_context: dict[str, Path | str], task: dict[str, Any]
) -> tuple[str, Path, Path]:
    """Validate the task payload and its run-confined uploaded input files."""

    # read the server-provided file references before resolving them inside this run's folder
    payload = task.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("script_runner task requires an object payload.")

    runner_value = payload.get("runnerPath")
    config_value = payload.get("configPath")
    language_value = payload.get("runnerScriptLanguage")
    if not isinstance(runner_value, str) or not runner_value.strip():
        raise ValueError("script_runner task requires payload.runnerPath.")
    if not isinstance(config_value, str) or not config_value.strip():
        raise ValueError("script_runner task requires payload.configPath.")
    if not isinstance(language_value, str) or not language_value.strip():
        raise ValueError("script_runner task requires payload.runnerScriptLanguage.")

    # resolve both paths through the run boundary, then require the expected script language and extension
    runner_path = resolve_run_relative_path(run_context, runner_value)
    config_path = resolve_run_relative_path(run_context, config_value)
    if not runner_path.is_file():
        raise FileNotFoundError(f"Uploaded runner was not found at {runner_path}")
    if not config_path.is_file():
        raise FileNotFoundError(f"Uploaded task plan was not found at {config_path}")

    language = language_value.strip().casefold()
    expected_extension = {"python": ".py", "powershell": ".ps1"}.get(language)
    if expected_extension is None:
        raise ValueError(f"Unsupported uploaded runner language '{language_value}'.")
    if runner_path.suffix.casefold() != expected_extension:
        raise ValueError(
            f"Uploaded {language} runner must use the '{expected_extension}' extension: {runner_path.name}"
        )
    return language, runner_path, config_path


def custom_runner_command(language: str, runner_path: Path, config_path: Path) -> list[str]:
    """Return the established command-line contract for an uploaded runner."""

    # keep Python and PowerShell invocation flags compatible with the existing uploaded-runner contract
    if language == "python":
        python_executable = Path(sys.executable) if sys.executable else None
        if python_executable is None or not python_executable.is_file():
            raise RuntimeError("Python is not available inside the Windows guest.")
        return [str(python_executable), str(runner_path), "--plan", str(config_path)]

    if language == "powershell":
        powershell_executable = shutil.which("powershell.exe") or shutil.which("powershell")
        if not powershell_executable:
            raise RuntimeError("PowerShell is not available inside the Windows guest.")
        return [
            powershell_executable,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(runner_path),
            "-ConfigPath",
            str(config_path),
        ]

    raise ValueError(f"Unsupported uploaded runner language '{language}'.")


# Timestamp helper used to create fresh demo filenames.
def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


# Add a timestamp before the extension so every demo run opens a fresh Notepad
# file. This avoids Windows 11 Notepad restoring or warning about older tabs.
def unique_demo_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}-{timestamp()}{path.suffix}")


# Resolve a path from the JSON plan. Relative paths are anchored beside this
# runner so the demo behaves the same no matter where the shell was opened.
def resolve_demo_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None

    path = Path(path_value)
    if path.is_absolute():
        return path
    return SCRIPT_DIR / path


def resolve_notepad_file_path(file_name: Any, file_dir: Path | None = None) -> Path | None:
    """Resolve a standalone demo file or constrain an agent file to its run."""

    if not file_name:
        return None
    if file_dir is not None:
        # Task plans can originate on Windows hosts and therefore may contain
        # either slash convention. PureWindowsPath consistently strips both
        # parent components before the filename is placed in this run's output.
        return file_dir / PureWindowsPath(str(file_name)).name
    return resolve_demo_path(str(file_name))


# Convert pywinauto's rectangle object into plain JSON-friendly numbers.
def rectangle_to_dict(rect: Any) -> dict[str, int]:
    return {
        "left": int(rect.left),
        "top": int(rect.top),
        "right": int(rect.right),
        "bottom": int(rect.bottom),
        "width": int(rect.right - rect.left),
        "height": int(rect.bottom - rect.top),
    }


def move_window_with_win32(window: Any, bounds: dict[str, Any]) -> dict[str, int]:
    """
    Move a pywinauto window wrapper using Win32 instead of wrapper methods.

    Some UIAWrapper instances do not expose move_window(). Win32 MoveWindow is
    a stable fallback because pywinauto still exposes the native window handle.
    """

    x = int_value(bounds.get("x"), 100)
    y = int_value(bounds.get("y"), 100)
    width = int_value(bounds.get("width"), 900)
    height = int_value(bounds.get("height"), 650)

    handle = int(getattr(window, "handle", 0) or 0)
    if not handle:
        raise RuntimeError("Cannot move window because pywinauto did not expose a native window handle.")

    moved = ctypes.windll.user32.MoveWindow(handle, x, y, width, height, True)
    if not moved:
        error_code = ctypes.get_last_error()
        raise RuntimeError(f"MoveWindow failed with Win32 error code {error_code}.")

    return {
        "x": x,
        "y": y,
        "width": width,
        "height": height,
    }


def get_win32_window_text(hwnd: int) -> str:
    """Read a native window title without going through UIA."""

    length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    ctypes.windll.user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def get_win32_class_name(hwnd: int) -> str:
    """Read a native Win32 class name such as #32770 for common dialogs."""

    buffer = ctypes.create_unicode_buffer(256)
    ctypes.windll.user32.GetClassNameW(hwnd, buffer, len(buffer))
    return buffer.value


def get_win32_window_rect(hwnd: int) -> dict[str, int]:
    """Return a visible window's screen rectangle using Win32 APIs."""

    rect = wintypes.RECT()
    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return {
        "left": int(rect.left),
        "top": int(rect.top),
        "right": int(rect.right),
        "bottom": int(rect.bottom),
        "width": int(rect.right - rect.left),
        "height": int(rect.bottom - rect.top),
    }


def list_visible_top_level_windows() -> list[dict[str, Any]]:
    """Enumerate visible top-level windows for dialog discovery/debugging."""

    windows: list[dict[str, Any]] = []
    enum_proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def enum_proc(hwnd: int, _lparam: int) -> bool:
        if ctypes.windll.user32.IsWindowVisible(hwnd):
            title = get_win32_window_text(hwnd)
            class_name = get_win32_class_name(hwnd)
            if title or class_name:
                windows.append(
                    {
                        "hwnd": int(hwnd),
                        "title": title,
                        "className": class_name,
                        "rectangle": get_win32_window_rect(hwnd),
                    }
                )
        return True

    ctypes.windll.user32.EnumWindows(enum_proc_type(enum_proc), 0)
    return windows


def write_top_level_windows_snapshot(
    output_path: Path, title: str, relative_root: Path | None = None
) -> dict[str, Any]:
    """Write visible top-level Win32 windows when UIA cannot see a dialog."""

    windows = list_visible_top_level_windows()
    lines = [
        title,
        f"Generated: {datetime.now().isoformat()}",
        "",
    ]

    for index, window in enumerate(windows):
        rect = window["rectangle"]
        lines.append(
            f"{index:03d} "
            f"hwnd={window['hwnd']} "
            f"title={window['title']!r} "
            f"className={window['className']!r} "
            f"rect=({rect['left']},{rect['top']},{rect['right']},{rect['bottom']})"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "path": artifact_path(output_path, relative_root),
        "windowCount": len(windows),
    }


def artifact_path(output_path: Path, relative_root: Path | None = None) -> str:
    """Return an artifact reference relative to its current execution boundary."""

    return str(output_path.relative_to(relative_root or SCRIPT_DIR)).replace("\\", "/")


def wait_for_win32_font_dialog(
    timeout_seconds: int, abort_check: Callable[[], None] | None = None
) -> dict[str, Any] | None:
    """
    Find the classic Font dialog through Win32 instead of UIA.

    The VM showed the Font dialog visually while UIA still timed out waiting for
    a wrapper named "Font". The native dialog has a stable #32770 class, so this
    path is better for classic Windows dialogs.
    """

    deadline = time.monotonic() + max(timeout_seconds, 1)
    while time.monotonic() < deadline:
        if abort_check is not None:
            abort_check()
        for window in list_visible_top_level_windows():
            if window["title"].casefold() == "font" and window["className"] == "#32770":
                return window
        interruptible_sleep(0.2, abort_check)

    return None


def focus_win32_window(hwnd: int, abort_check: Callable[[], None] | None = None) -> None:
    """Bring a native window to the foreground before sending keyboard input."""

    if abort_check is not None:
        abort_check()
    ctypes.windll.user32.ShowWindow(hwnd, 9)
    ctypes.windll.user32.SetForegroundWindow(hwnd)
    interruptible_sleep(0.2, abort_check)


def is_win32_window_visible(hwnd: int) -> bool:
    """Check whether a native window still exists and is visible."""

    return bool(ctypes.windll.user32.IsWindow(hwnd)) and bool(ctypes.windll.user32.IsWindowVisible(hwnd))


# Summarize one UI Automation control. The same shape is used in result.json
# and control-tree.txt so teammates can connect "what was clicked" to "what
# pywinauto saw."
def control_summary(control: Any) -> dict[str, Any]:
    info = control.element_info
    return {
        "name": str(getattr(info, "name", "") or control.window_text() or ""),
        "controlType": str(getattr(info, "control_type", "") or ""),
        "automationId": str(getattr(info, "automation_id", "") or ""),
        "className": str(getattr(info, "class_name", "") or ""),
        "rectangle": rectangle_to_dict(control.rectangle()),
    }


# Format one control-tree line. Some controls can throw when inspected, so this
# helper keeps the artifact useful even if one control is unreadable.
def safe_control_line(index: int, control: Any) -> str:
    try:
        summary = control_summary(control)
        rect = summary["rectangle"]
        return (
            f"{index:03d} "
            f"type={summary['controlType']!r} "
            f"name={summary['name']!r} "
            f"automationId={summary['automationId']!r} "
            f"className={summary['className']!r} "
            f"rect=({rect['left']},{rect['top']},{rect['right']},{rect['bottom']})"
        )
    except Exception as exc:
        return f"{index:03d} <unreadable control: {type(exc).__name__}: {exc}>"


# Write every visible descendant control under the active Notepad window.
# This file is the discovery tool for creating future namedTargets entries.
def write_control_tree(
    window: Any, output_path: Path, limit: int = 300, relative_root: Path | None = None
) -> dict[str, Any]:
    controls = window.descendants()
    lines = [
        "DockVision pywinauto/UI Automation control tree",
        f"Window: {window.window_text()!r}",
        f"Generated: {datetime.now().isoformat()}",
        "",
    ]

    for index, control in enumerate(controls[:limit]):
        lines.append(safe_control_line(index, control))

    if len(controls) > limit:
        lines.append(f"... truncated {len(controls) - limit} additional controls")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "path": artifact_path(output_path, relative_root),
        "controlCount": len(controls),
    }


def write_control_snapshot(
    root_control: Any,
    output_path: Path,
    title: str,
    limit: int = 300,
    relative_root: Path | None = None,
) -> dict[str, Any]:
    """
    Write a focused UIA snapshot for temporary windows such as the Font dialog.

    The main startup control tree only covers the Notepad window. Dialogs and
    pop-up menus are separate UIA windows, so this helper gives failed dialog
    steps their own artifact.
    """

    controls = [root_control]
    try:
        controls.extend(root_control.descendants())
    except Exception:
        pass

    lines = [
        title,
        f"Root: {root_control.window_text()!r}",
        f"Generated: {datetime.now().isoformat()}",
        "",
    ]

    for index, control in enumerate(controls[:limit]):
        lines.append(safe_control_line(index, control))

    if len(controls) > limit:
        lines.append(f"... truncated {len(controls) - limit} additional controls")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "path": artifact_path(output_path, relative_root),
        "controlCount": len(controls),
    }


# Prefer visible controls when multiple candidates match. If visibility cannot
# be checked, keep the control rather than discarding useful UIA data.
def is_usable_control(control: Any) -> bool:
    try:
        return bool(control.is_visible())
    except Exception:
        return True


def control_matches_candidate(control: Any, candidate: dict[str, Any]) -> bool:
    """
    Decide whether one UIA control matches one namedTargets candidate.

    The earlier prototype tried window.descendants(control_type="Document"),
    but that was brittle across pywinauto builds. This manual matcher reads the
    same fields shown in control-tree.txt and compares them directly.
    """

    try:
        info = control.element_info
        name = str(getattr(info, "name", "") or control.window_text() or "")
        control_type = str(getattr(info, "control_type", "") or "")
        automation_id = str(getattr(info, "automation_id", "") or "")
        class_name = str(getattr(info, "class_name", "") or "")
    except Exception:
        return False

    expected_title = candidate.get("title")
    if expected_title and name != str(expected_title):
        return False

    expected_title_regex = candidate.get("titleRegex")
    if expected_title_regex and not re.search(str(expected_title_regex), name):
        return False

    expected_control_type = candidate.get("controlType")
    if expected_control_type and control_type.casefold() != str(expected_control_type).casefold():
        return False

    expected_auto_id = candidate.get("autoId")
    if expected_auto_id and automation_id != str(expected_auto_id):
        return False

    expected_class_name = candidate.get("className")
    if expected_class_name and class_name != str(expected_class_name):
        return False

    return True


def find_global_control_by_candidate(
    candidate: dict[str, Any],
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> Any | None:
    """
    Search all top-level UIA windows for a transient control.

    Classic Notepad's Format menu popup is not a stable descendant of the main
    Notepad window, so dialog/menu automation needs a desktop-wide lookup.
    """

    from pywinauto import Desktop
    from pywinauto.keyboard import send_keys

    found_index = int_value(candidate.get("foundIndex"), 0)
    deadline = time.monotonic() + max(timeout_seconds, 1)

    while time.monotonic() < deadline:
        if abort_check is not None:
            abort_check()
        try:
            matches: list[Any] = []
            for top_window in Desktop(backend="uia").windows():
                if abort_check is not None:
                    abort_check()
                controls = [top_window]
                try:
                    controls.extend(top_window.descendants())
                except Exception:
                    pass

                matches.extend(
                    control
                    for control in controls
                    if control_matches_candidate(control, candidate)
                )

            usable_matches = [control for control in matches if is_usable_control(control)]
            matches = usable_matches or matches

            if len(matches) > found_index:
                return matches[found_index]
        except Exception:
            pass

        interruptible_sleep(0.25, abort_check)

    return None


def find_control_by_candidates(
    window: Any,
    candidates: list[dict[str, Any]],
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> tuple[Any | None, dict[str, Any] | None, list[dict[str, Any]]]:
    """Try several UIA candidate shapes and report exactly what was attempted."""

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_control_by_candidate(window, candidate, timeout_seconds, abort_check)
        if control is not None:
            return control, candidate, attempted

    return None, None, attempted


def find_global_control_by_candidates(
    candidates: list[dict[str, Any]],
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> tuple[Any | None, dict[str, Any] | None, list[dict[str, Any]]]:
    """Try several desktop-wide UIA candidates for pop-up menus and dialogs."""

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_global_control_by_candidate(candidate, timeout_seconds, abort_check)
        if control is not None:
            return control, candidate, attempted

    return None, None, attempted


def click_control_center(control: Any, button: str = "left") -> dict[str, Any]:
    """Click the center of a resolved UIA control and return click details."""

    from pywinauto import mouse

    control_rect = rectangle_to_dict(control.rectangle())
    x, y = calculate_point_in_rect(control_rect, 50.0, 50.0)
    mouse.click(button=button, coords=(x, y))
    return {
        "button": button,
        "point": {"x": x, "y": y},
        "control": control_summary(control),
    }


# Search the active window for the first control matching a candidate. A named
# target can define several candidates, and each candidate can choose foundIndex
# if multiple controls match the same pattern.
def find_control_by_candidate(
    window: Any,
    candidate: dict[str, Any],
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> Any | None:
    found_index = int_value(candidate.get("foundIndex"), 0)
    deadline = time.monotonic() + max(timeout_seconds, 1)

    while time.monotonic() < deadline:
        if abort_check is not None:
            abort_check()
        try:
            matches = [
                control
                for control in window.descendants()
                if control_matches_candidate(control, candidate)
            ]
            usable_matches = [control for control in matches if is_usable_control(control)]
            matches = usable_matches or matches

            if len(matches) > found_index:
                return matches[found_index]
        except Exception:
            pass

        interruptible_sleep(0.25, abort_check)

    return None


# Resolve a user-facing target name such as "notepad.fileMenu" to a real
# pywinauto control. This is the heart of the named-control architecture.
def resolve_named_control(
    window: Any,
    named_targets: dict[str, Any],
    target_name: str,
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> tuple[Any, dict[str, Any]]:
    target_definition = named_targets.get(target_name)
    if not target_definition:
        raise ValueError(f"Unknown named target: {target_name}")

    candidates = target_definition.get("candidates") or []
    if not candidates:
        raise ValueError(f"Named target '{target_name}' does not define any candidates.")

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_control_by_candidate(window, candidate, timeout_seconds, abort_check)
        if control is not None:
            return control, {
                "name": target_name,
                "description": target_definition.get("description", ""),
                "matchedCandidate": candidate,
                "defaultPoint": target_definition.get("defaultPoint") or {},
            }

    raise RuntimeError(f"Could not resolve named target '{target_name}'. Attempted: {attempted}")


# Convert a percent position inside a control rectangle into an absolute screen
# coordinate. This is what lets the UI say "center of File menu" or "80% across
# the editor" without hardcoding the screen location.
def calculate_point_in_rect(rect: dict[str, int], x_percent: float, y_percent: float, x_offset: int = 0, y_offset: int = 0) -> tuple[int, int]:
    x_percent = min(max(x_percent, 0.0), 100.0)
    y_percent = min(max(y_percent, 0.0), 100.0)

    x = rect["left"] + round(rect["width"] * (x_percent / 100.0)) + x_offset
    y = rect["top"] + round(rect["height"] * (y_percent / 100.0)) + y_offset
    return int(x), int(y)


# Resolve a CLICK target from task-plan.json into a final screen coordinate.
# namedControl is the goal architecture, while windowPoint and screenPoint are
# kept as lower-level fallbacks for debugging or edge cases.
def resolve_click_target(
    active_window: Any,
    named_targets: dict[str, Any],
    target: dict[str, Any],
    timeout_seconds: int,
    abort_check: Callable[[], None] | None = None,
) -> dict[str, Any]:
    target_type = str(target.get("type") or "namedControl")

    if target_type == "namedControl":
        target_name = str(target.get("name") or "")
        if not target_name:
            raise ValueError("CLICK target.type 'namedControl' requires target.name.")

        control, target_info = resolve_named_control(
            active_window, named_targets, target_name, timeout_seconds, abort_check
        )
        control_rect = rectangle_to_dict(control.rectangle())
        default_point = target_info.get("defaultPoint") or {}

        x_percent = float_value(target.get("xPercent"), float_value(default_point.get("xPercent"), 50.0))
        y_percent = float_value(target.get("yPercent"), float_value(default_point.get("yPercent"), 50.0))
        x_offset = int_value(target.get("xOffset"), 0)
        y_offset = int_value(target.get("yOffset"), 0)
        x, y = calculate_point_in_rect(control_rect, x_percent, y_percent, x_offset, y_offset)

        return {
            "type": target_type,
            "namedTarget": target_name,
            "point": {"x": x, "y": y},
            "xPercent": x_percent,
            "yPercent": y_percent,
            "xOffset": x_offset,
            "yOffset": y_offset,
            "control": control_summary(control),
            "matchedCandidate": target_info["matchedCandidate"],
        }

    if target_type == "windowPoint":
        window_rect = rectangle_to_dict(active_window.rectangle())
        x = window_rect["left"] + int_value(target.get("x"), 0)
        y = window_rect["top"] + int_value(target.get("y"), 0)
        return {
            "type": target_type,
            "point": {"x": x, "y": y},
            "window": window_rect,
        }

    if target_type == "screenPoint":
        return {
            "type": target_type,
            "point": {
                "x": int_value(target.get("x"), 0),
                "y": int_value(target.get("y"), 0),
            },
        }

    raise ValueError(f"Unsupported CLICK target.type: {target_type}")


# Normalize the different ways a CLICK task can express its target. The clean
# user contract can say "target": "fileMenu", while advanced/debug contracts can
# still pass a full target object with xPercent/yPercent overrides.
def click_target_from_step(step: dict[str, Any]) -> dict[str, Any]:
    raw_target = step.get("target") or {}

    if isinstance(raw_target, str):
        target = {
            "type": "namedControl",
            "name": raw_target,
        }
    elif isinstance(raw_target, dict):
        target = dict(raw_target)
    else:
        raise ValueError(f"CLICK step '{step.get('id')}' has invalid target.")

    if "type" not in target:
        target["type"] = "namedControl"

    for key in ("name", "xPercent", "yPercent", "xOffset", "yOffset", "x", "y"):
        if key in step and key not in target:
            target[key] = step[key]

    return target


# Send text through pywinauto in small pieces. Special characters need escaping
# because pywinauto's send_keys uses a syntax where braces and modifier symbols
# have special meanings.
def interruptible_sleep(seconds: float, abort_check: Callable[[], None] | None = None) -> None:
    """Sleep in short slices so cancellation and timeout are observed promptly."""

    remaining = max(seconds, 0.0)
    while remaining > 0:
        if abort_check is not None:
            abort_check()
        interval = min(remaining, 0.1)
        time.sleep(interval)
        remaining -= interval
    if abort_check is not None:
        abort_check()


def send_text_human_like(
    text: str, delay_ms: int, abort_check: Callable[[], None] | None = None
) -> None:
    from pywinauto.keyboard import send_keys

    delay_seconds = max(delay_ms, 0) / 1000.0

    for character in text:
        if abort_check is not None:
            abort_check()
        if character == "\r":
            continue
        if character == "\n":
            keys = "{ENTER}"
        elif character == "\t":
            keys = "{TAB}"
        elif character == "{":
            keys = "{{}"
        elif character == "}":
            keys = "{}}"
        elif character in "+^%~()[]":
            keys = f"{{{character}}}"
        else:
            keys = character

        send_keys(keys, with_spaces=True)

        if delay_seconds:
            interruptible_sleep(delay_seconds, abort_check)


def set_classic_notepad_font_style(
    active_window: Any,
    named_targets: dict[str, Any],
    style: str,
    timeout_seconds: int,
    artifact_dir: Path = ARTIFACT_DIR,
    artifact_relative_root: Path | None = None,
    abort_check: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """
    Drive classic Notepad's Format -> Font... dialog and choose a font style.

    Classic Notepad applies this style to the whole editor display instead of
    storing rich per-line formatting. The purpose here is to exercise the real
    user path through Notepad's menu and Font dialog.
    """

    from pywinauto import Desktop
    from pywinauto.keyboard import send_keys

    normalized_style = str(style or "").strip().title()
    allowed_styles = {"Regular", "Italic", "Bold", "Bold Italic"}
    if normalized_style not in allowed_styles:
        raise RuntimeError(f"Unsupported classic Notepad font style: {style!r}")

    dialog_lookup_timeout = max(1, min(timeout_seconds, 2))

    if abort_check is not None:
        abort_check()
    active_window.set_focus()
    format_control, format_target_info = resolve_named_control(
        active_window,
        named_targets,
        "formatMenu",
        timeout_seconds,
        abort_check,
    )
    format_click = click_control_center(format_control)
    interruptible_sleep(0.25, abort_check)

    font_menu_item, font_menu_candidate, font_menu_attempted = find_global_control_by_candidates(
        [
            {"titleRegex": r"^Font", "controlType": "MenuItem"},
            {"titleRegex": r"^Font"},
        ],
        dialog_lookup_timeout,
        abort_check,
    )
    if font_menu_item is None:
        if abort_check is not None:
            abort_check()
        send_keys("f")
        font_menu_click = {
            "fallback": "formatMenuAccessKey",
            "keys": "f",
            "attempted": font_menu_attempted,
        }
    else:
        if abort_check is not None:
            abort_check()
        font_menu_click = click_control_center(font_menu_item)
        font_menu_click["matchedCandidate"] = font_menu_candidate

    interruptible_sleep(0.5, abort_check)

    dialog_window = wait_for_win32_font_dialog(dialog_lookup_timeout + 3, abort_check)
    top_level_snapshot = write_top_level_windows_snapshot(
        artifact_dir / f"top-level-windows-before-font-{normalized_style.casefold().replace(' ', '-')}.txt",
        f"DockVision top-level windows before selecting {normalized_style}",
        artifact_relative_root,
    )

    if dialog_window is None:
        # If the dialog is visible to the user but not discoverable through UIA
        # or Win32 enumeration, continue with the active window. This still keeps
        # the runner moving instead of timing out at the Font window.
        dialog_focus = {
            "fallback": "activeWindowKeyboardOnly",
            "message": "Could not resolve the Font dialog window handle; sending keyboard input to the active window.",
        }
        dialog_snapshot = {
            "skipped": True,
            "reason": "Font dialog handle was not found.",
        }
    else:
        focus_win32_window(int(dialog_window["hwnd"]), abort_check)
        dialog_focus = {
            "hwnd": dialog_window["hwnd"],
            "title": dialog_window["title"],
            "className": dialog_window["className"],
            "rectangle": dialog_window["rectangle"],
        }

        try:
            if abort_check is not None:
                abort_check()
            font_dialog = Desktop(backend="uia").window(handle=int(dialog_window["hwnd"])).wrapper_object()
            dialog_snapshot = write_control_snapshot(
                font_dialog,
                artifact_dir / f"font-dialog-{normalized_style.casefold().replace(' ', '-')}.txt",
                f"DockVision Font dialog snapshot before selecting {normalized_style}",
                relative_root=artifact_relative_root,
            )
        except Exception as exc:
            dialog_snapshot = {
                "skipped": True,
                "reason": f"UIA snapshot failed: {type(exc).__name__}: {exc}",
            }

    # Keyboard path for the classic Font dialog:
    # Alt+Y focuses "Font style", Ctrl+A replaces the current style text, and
    # Alt+O activates OK. This is closer to a user-operated dialog than poking
    # individual child controls, and it avoids the UIA timeout seen in the VM.
    keys_sent = ["%y", "^a", normalized_style, "%o"]
    if abort_check is not None:
        abort_check()
    send_keys("%y")
    interruptible_sleep(0.1, abort_check)
    send_keys("^a")
    interruptible_sleep(0.05, abort_check)
    send_keys(normalized_style, with_spaces=True)
    interruptible_sleep(0.1, abort_check)
    send_keys("%o")
    interruptible_sleep(0.4, abort_check)

    ok_confirm = {
        "method": "keyboardAccessKeys",
        "keys": keys_sent,
    }

    if dialog_window is not None and is_win32_window_visible(int(dialog_window["hwnd"])):
        if abort_check is not None:
            abort_check()
        send_keys("{ENTER}")
        ok_confirm["fallback"] = "enterAfterAltO"
        ok_confirm["fallbackKey"] = "{ENTER}"
        interruptible_sleep(0.4, abort_check)

    if dialog_window is not None and is_win32_window_visible(int(dialog_window["hwnd"])):
        raise RuntimeError(f"Font dialog did not close after selecting {normalized_style}.")

    if abort_check is not None:
        abort_check()
    active_window.set_focus()
    return {
        "fontStyle": normalized_style,
        "formatMenu": {
            "matchedCandidate": format_target_info["matchedCandidate"],
            "click": format_click,
        },
        "fontMenuItem": font_menu_click,
        "fontDialog": dialog_focus,
        "topLevelWindowsSnapshot": top_level_snapshot,
        "fontDialogSnapshot": dialog_snapshot,
        "styleSelection": {
            "method": "keyboardAccessKeys",
            "targetAccessKey": "Alt+Y",
            "typedStyle": normalized_style,
        },
        "okButton": ok_confirm,
    }


# Execute OPEN_APP. For this demo, that means preparing a fresh Notepad file,
# launching Notepad, finding the correct window by title, and making the window
# predictable before later CLICK steps run.
def open_app(
    step: dict[str, Any],
    timeout_seconds: int,
    file_dir: Path | None = None,
    abort_check: Callable[[], None] | None = None,
    opened_window_callback: Callable[[Any], None] | None = None,
) -> dict[str, Any]:
    from pywinauto import Application, Desktop

    executable = str(step.get("executable") or "notepad.exe")
    file_name = step.get("fileName")
    target_file = resolve_notepad_file_path(file_name, file_dir=file_dir)

    if target_file is not None:
        if bool_value(step.get("uniqueFilePerRun")):
            target_file = unique_demo_path(target_file)

        if bool_value(step.get("resetFile")) or bool_value(step.get("uniqueFilePerRun")):
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text("", encoding="utf-8")
        elif not target_file.exists():
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.touch()

        command_line = f'"{executable}" "{target_file}"'
        title_regex = rf".*{re.escape(target_file.name)}.*"
    else:
        command_line = executable
        title_regex = r".*Notepad.*"

    if abort_check is not None:
        abort_check()
    Application(backend="uia").start(command_line)

    window_spec = Desktop(backend="uia").window(title_re=title_regex)
    deadline = time.monotonic() + max(timeout_seconds, 1)
    window = None
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if abort_check is not None:
            abort_check()
        try:
            if window_spec.exists(timeout=0.1):
                window = window_spec.wrapper_object()
                if window.is_visible() and window.is_enabled():
                    break
                window = None
        except Exception as exc:
            last_error = exc
            window = None
        interruptible_sleep(0.1, abort_check)

    if window is None:
        detail = f": {type(last_error).__name__}: {last_error}" if last_error is not None else ""
        raise RuntimeError(f"Notepad window did not become visible and ready within {timeout_seconds} seconds{detail}")
    if opened_window_callback is not None:
        opened_window_callback(window)

    bounds = step.get("windowBounds") or {}
    if bounds:
        if abort_check is not None:
            abort_check()
        move_window_with_win32(window, bounds)
        interruptible_sleep(0.5, abort_check)

    if abort_check is not None:
        abort_check()
    window.set_focus()
    interruptible_sleep(0.3, abort_check)

    return {
        "window": window,
        "file": str(target_file) if target_file else None,
        "title": window.window_text(),
    }


def app_config_from_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """Read runner-owned app setup from the plan and apply Notepad defaults."""

    app_config = dict(plan.get("app") or plan.get("targetApp") or {})
    app_name = str(app_config.get("name") or "notepad").lower()

    if app_name != "notepad":
        raise RuntimeError(f"This demo currently supports only Notepad, not '{app_name}'.")

    app_config.setdefault("name", "notepad")
    app_config.setdefault("executable", "notepad.exe")
    app_config.setdefault("fileName", "notepad-uia-demo.txt")
    app_config.setdefault("uniqueFilePerRun", True)
    app_config.setdefault("resetFile", True)
    app_config.setdefault("windowBounds", {"x": 100, "y": 100, "width": 900, "height": 650})
    return app_config


def named_targets_for_app(app_config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return the internal UIA target registry for the configured app."""

    app_name = str(app_config.get("name") or "notepad").lower()
    if app_name == "notepad":
        return NOTEPAD_TARGETS

    raise RuntimeError(f"No named target registry exists for app '{app_name}'.")


# Built-in Notepad worker. Each JSON step becomes one concrete runner action.
# The long-lived agent owns shared-root polling and lifecycle publication; this
# worker cooperates with its cancellation and iteration-timeout checkpoints.
def _execute_notepad_plan(
    plan: dict[str, Any],
    artifact_dir: Path = ARTIFACT_DIR,
    artifact_relative_root: Path | None = None,
    file_dir: Path | None = None,
    screenshot_dir: Path | None = None,
    screenshot_name: str | None = None,
    capture_screenshot: bool | None = None,
    abort_check: Callable[[], None] | None = None,
    opened_window_callback: Callable[[Any], None] | None = None,
) -> dict[str, Any]:
    from pywinauto import mouse
    from pywinauto.keyboard import send_keys

    settings = plan.get("settings") or {}
    timeout_seconds = int_value(settings.get("timeoutSeconds"), 20)
    step_delay_ms = int_value(settings.get("stepDelayMs"), 250)
    typing_delay_ms = int_value(settings.get("typingDelayMs"), 25)
    app_config = app_config_from_plan(plan)
    named_targets = named_targets_for_app(app_config)
    active_window: Any | None = None

    def check_abort() -> None:
        if abort_check is None:
            return
        try:
            abort_check()
        except (AgentTaskCancelled, AgentTaskTimedOut):
            raise

    artifact_dir.mkdir(parents=True, exist_ok=True)

    # Startup is runner-owned now. The user-authored JSON task list should not
    # have to include OPEN_APP or INSPECT just to make CLICK/TYPE possible.
    check_abort()
    opened = open_app(
        app_config,
        timeout_seconds,
        file_dir=file_dir,
        abort_check=check_abort,
        opened_window_callback=opened_window_callback,
    )
    active_window = opened["window"]
    check_abort()
    opened_file = opened["file"]
    steps_result: list[dict[str, Any]] = []
    artifacts: dict[str, str] = {}
    startup_result = {
        "action": "OPEN_APP",
        "status": "completed",
        "windowTitle": opened["title"],
        "file": opened_file,
    }

    # Always inspect after startup. This keeps debugging information available
    # without making INSPECT a user-facing task in task-plan.json.
    control_tree_path = artifact_dir / "control-tree.txt"
    inspect_result = write_control_tree(
        active_window, control_tree_path, relative_root=artifact_relative_root
    )
    artifacts["controlTree"] = inspect_result["path"]
    startup_result["inspect"] = inspect_result

    for step in plan.get("tasks") or plan.get("steps") or []:
        check_abort()
        # Normalize the step identity early so every result object has a stable
        # id/action pair regardless of whether a later operation fails.
        step_id = str(step.get("id") or "step")
        action = str(step.get("action") or "").upper()
        step_result: dict[str, Any] = {
            "id": step_id,
            "action": action,
            "status": "completed",
        }

        if action == "CLICK":
            # CLICK resolves the task's target to a specific screen point, then
            # pywinauto sends the requested mouse button at that point.
            active_window.set_focus()
            resolved = resolve_click_target(
                active_window=active_window,
                named_targets=named_targets,
                target=click_target_from_step(step),
                timeout_seconds=timeout_seconds,
                abort_check=check_abort,
            )
            button = str(step.get("button") or "left").lower()
            click_count = max(int_value(step.get("clickCount"), 1), 1)
            coords = (resolved["point"]["x"], resolved["point"]["y"])

            for index in range(click_count):
                check_abort()
                mouse.click(button=button, coords=coords)
                if index < click_count - 1:
                    interruptible_sleep(0.1, check_abort)

            step_result["button"] = button
            step_result["clickCount"] = click_count
            step_result["resolvedTarget"] = resolved

        elif action == "TYPE":
            # TYPE assumes a previous CLICK or focus operation put the caret in
            # the right control. The click contract and type contract stay
            # separate so Task-i-fy can generate them independently.
            active_window.set_focus()
            text = str(step.get("text") or "")
            send_text_human_like(text, typing_delay_ms, abort_check=check_abort)
            step_result["typedCharacterCount"] = len(text)

        elif action == "SET_FONT_STYLE":
            # Classic Notepad exposes Italic through Format -> Font..., not
            # through a toolbar. This runner-owned action keeps the JSON focused
            # on user intent while the runner handles the dialog details.
            style = str(step.get("style") or "")
            if not style:
                raise RuntimeError(f"{step_id} requires style.")

            step_result["fontDialog"] = set_classic_notepad_font_style(
                active_window=active_window,
                named_targets=named_targets,
                style=style,
                timeout_seconds=timeout_seconds,
                artifact_dir=artifact_dir,
                artifact_relative_root=artifact_relative_root,
                abort_check=check_abort,
            )

        elif action == "KEY":
            # KEY is used for small keyboard commands such as Escape after a
            # menu click. It gives the demo a clean way to close transient UI.
            keys = str(step.get("keys") or "")
            if not keys:
                raise RuntimeError(f"{step_id} requires keys.")

            send_keys(keys)
            step_result["keys"] = keys

        elif action == "WAIT":
            # WAIT exists mostly for humans watching the demo. It gives menus
            # and context menus time to be visibly open before the next step.
            delay_ms = int_value(step.get("delayMs"), step_delay_ms)
            interruptible_sleep(max(delay_ms, 0) / 1000.0, check_abort)
            step_result["delayMs"] = delay_ms

        else:
            raise RuntimeError(f"Unsupported action '{action}' in step '{step_id}'.")

        steps_result.append(step_result)

        if step_delay_ms > 0:
            interruptible_sleep(step_delay_ms / 1000.0, check_abort)

    result: dict[str, Any] = {
        "status": "completed",
        "planName": plan.get("name"),
        "finishedAt": datetime.now().isoformat(),
        "automationBackend": "python-pywinauto-uia",
        "openedFile": opened_file,
        "artifacts": artifacts,
        "startup": startup_result,
        "steps": steps_result,
    }

    should_capture_screenshot = bool_value(
        plan.get("captureScreenshot"), True
    ) if capture_screenshot is None else capture_screenshot
    if should_capture_screenshot and screenshot_dir is not None:
        check_abort()
        screenshot_path = screenshot_dir / (screenshot_name or "notepad.png")
        try:
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            active_window.capture_as_image().save(screenshot_path)
            artifacts["screenshot"] = artifact_path(screenshot_path, artifact_relative_root)
        except Exception as exc:
            result["screenshotWarning"] = f"{type(exc).__name__}: {exc}"

    return result


def execute_notepad_plan(
    plan: dict[str, Any],
    artifact_dir: Path = ARTIFACT_DIR,
    artifact_relative_root: Path | None = None,
    file_dir: Path | None = None,
    screenshot_dir: Path | None = None,
    screenshot_name: str | None = None,
    capture_screenshot: bool | None = None,
    abort_check: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Run a plan and close only its run-owned Notepad window after a failure."""

    # remember the window opened for this plan so error cleanup cannot close an unrelated Notepad window
    opened_window: Any | None = None

    def remember_opened_window(window: Any) -> None:
        nonlocal opened_window
        opened_window = window

    try:
        return _execute_notepad_plan(
            plan,
            artifact_dir=artifact_dir,
            artifact_relative_root=artifact_relative_root,
            file_dir=file_dir,
            screenshot_dir=screenshot_dir,
            screenshot_name=screenshot_name,
            capture_screenshot=capture_screenshot,
            abort_check=abort_check,
            opened_window_callback=remember_opened_window,
        )
    except Exception:
        if opened_window is not None:
            try:
                opened_window.close()
            except Exception:
                pass
        raise


# Compatibility boundary for existing direct callers and uploaded copies of this
# runner. New runtime code should call dispatch_builtin_notepad_task() instead.
def execute_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return execute_notepad_plan(plan)


def dispatch_builtin_notepad_task(
    plan: dict[str, Any],
    artifact_dir: Path = ARTIFACT_DIR,
    artifact_relative_root: Path | None = None,
    file_dir: Path | None = None,
    screenshot_dir: Path | None = None,
    screenshot_name: str | None = None,
    capture_screenshot: bool | None = None,
    abort_check: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Dispatch DockVision's built-in task-plan workload to the Notepad worker."""

    # keep the agent-facing built-in dispatch boundary separate from the lower-level Notepad executor
    return execute_notepad_plan(
        plan,
        artifact_dir=artifact_dir,
        artifact_relative_root=artifact_relative_root,
        file_dir=file_dir,
        screenshot_dir=screenshot_dir,
        screenshot_name=screenshot_name,
        capture_screenshot=capture_screenshot,
        abort_check=abort_check,
    )


def dispatch_custom_python_runner(runner_path: Path, config_path: Path) -> dict[str, Any]:
    """
    Reserved custom-Python runner dispatch boundary.

    The agent implementation must provide run-scoped path validation, process
    lifecycle/cancellation, output capture, and timeout handling before an
    uploaded program can be launched. Keeping that work out of the Notepad
    worker prevents a partially implemented agent mode from executing arbitrary
    uploads without supervision.
    """

    raise RuntimeError(
        "Custom Python runner dispatch is not configured yet "
        f"(runner={runner_path}, config={config_path})."
    )


def dispatch_custom_powershell_runner(runner_path: Path, config_path: Path) -> dict[str, Any]:
    """Reserved custom-PowerShell runner dispatch boundary; see Python equivalent."""

    raise RuntimeError(
        "Custom PowerShell runner dispatch is not configured yet "
        f"(runner={runner_path}, config={config_path})."
    )


def dispatch_custom_runner(language: str, runner_path: Path, config_path: Path) -> dict[str, Any]:
    """Route an uploaded runner to its language-specific dispatch boundary."""

    normalized_language = language.strip().casefold()
    if normalized_language == "python":
        return dispatch_custom_python_runner(runner_path, config_path)
    if normalized_language == "powershell":
        return dispatch_custom_powershell_runner(runner_path, config_path)

    raise RuntimeError(f"Unsupported custom runner language: {language or '(missing)'}")


def run_agent_loop(
    shared_root: Path | None = None,
    heartbeat_interval_seconds: float = HEARTBEAT_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    max_heartbeats: int | None = None,
    task_executor: Callable[[dict[str, Path | str], dict[str, Any], Path], dict[str, Any]] = execute_agent_task,
) -> int:
    """
    Run the long-lived agent polling loop.

    Each polling cycle publishes idle availability, claims at most one queued
    active task, and restores idle state after its terminal result is published.
    The injectable executor keeps lifecycle tests independent from VM UI work.
    """

    # resolve and initialize the shared transport once before the recurring polling work starts
    resolved_shared_root = shared_root or resolve_shared_root()
    ensure_agent_shared_layout(resolved_shared_root)
    append_agent_install_log(resolved_shared_root, "Python agent startup begin.")
    append_agent_install_log(resolved_shared_root, f"Resolved shared root to: {resolved_shared_root}")
    append_agent_install_log(resolved_shared_root, "Agent polling loop starting.")

    emitted_heartbeats = 0
    # each cycle advertises idle availability, processes at most one task, and then waits for the next cycle
    while max_heartbeats is None or emitted_heartbeats < max_heartbeats:
        write_agent_heartbeat(
            resolved_shared_root,
            status="idle",
            task_name="waiting_for_task",
        )
        try:
            process_queued_active_task(resolved_shared_root, executor=task_executor)
        except Exception as exc:
            append_agent_install_log(resolved_shared_root, f"Agent task polling error: {exc}")
            write_agent_heartbeat(
                resolved_shared_root,
                status="idle",
                task_name="waiting_for_task",
            )
        emitted_heartbeats += 1

        if max_heartbeats is None or emitted_heartbeats < max_heartbeats:
            sleep(max(heartbeat_interval_seconds, 0.0))

    return 0


def run_agent() -> int:
    """Production CLI entry for the agent polling loop."""

    return run_agent_loop()


# CLI boundary. --plan preserves the established standalone worker contract;
# --agent is the explicit future long-running DockVision runtime entry point.
def parse_args() -> argparse.Namespace:
    # accept either the long-running agent mode or the established standalone plan mode
    parser = argparse.ArgumentParser(
        description="Run the DockVision Notepad worker or the DockVision VM agent runtime."
    )
    parser.add_argument(
        "--agent",
        action="store_true",
        help="Run the long-lived DockVision VM agent instead of the standalone Notepad worker.",
    )
    parser.add_argument("--plan", default=str(SCRIPT_DIR / "task-plan.json"), help="Path to task-plan.json")
    return parser.parse_args()


# Standalone worker entry. Always write result.json, even on failure, because
# the failure artifact is usually the fastest way to understand what went wrong.
def run_standalone_notepad_worker(plan_path: Path) -> int:
    # keep standalone success and failure results in the same artifact location for manual diagnosis
    result_path = ARTIFACT_DIR / "result.json"

    try:
        plan = read_json(plan_path)
        result = dispatch_builtin_notepad_task(plan)
        write_json(result_path, result)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result = {
            "status": "failed",
            "finishedAt": datetime.now().isoformat(),
            "automationBackend": "python-pywinauto-uia",
            "message": str(exc),
            "errorType": type(exc).__name__,
        }
        write_json(result_path, result)
        print(json.dumps(result, indent=2))
        return 1


def main() -> int:
    # choose agent mode only when explicitly requested; otherwise preserve the standalone worker behavior
    args = parse_args()
    if args.agent:
        try:
            return run_agent()
        except Exception as exc:
            result = {
                "status": "failed",
                "finishedAt": datetime.now().isoformat(),
                "runtimeMode": "agent",
                "message": str(exc),
                "errorType": type(exc).__name__,
            }
            print(json.dumps(result, indent=2))
            return 1

    return run_standalone_notepad_worker(Path(args.plan))


if __name__ == "__main__":
    sys.exit(main())

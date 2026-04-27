import json
import platform
import getpass
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

SHARED_ROOT = Path(r"C:\shared")
ACTIVE_ROOT = SHARED_ROOT / "active"
RUNS_ROOT = SHARED_ROOT / "runs"
HEARTBEAT_PATH = SHARED_ROOT / "agent-heartbeat.json"
INSTALL_LOG_PATH = SHARED_ROOT / "agent-install-log.txt"
CURRENT_RUN_POINTER_PATH = ACTIVE_ROOT / "current-run.json"

AGENT_NAME = "DockVision Guest Agent"
AGENT_VERSION = "0.2.0"
HEARTBEAT_INTERVAL_SECONDS = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_shared_layout() -> None:
    SHARED_ROOT.mkdir(parents=True, exist_ok=True)
    ACTIVE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)


def get_run_paths(run_id: str) -> dict[str, Path]:
    run_root = RUNS_ROOT / run_id
    return {
        "run_root": run_root,
        "task_path": run_root / "task.json",
        "result_path": run_root / "result.json",
        "log_path": run_root / "logs" / "task.log",
        "screenshots_root": run_root / "screenshots",
        "artifacts_root": run_root / "artifacts",
    }


def ensure_run_layout(run_id: str) -> dict[str, Path]:
    run_paths = get_run_paths(run_id)
    run_paths["run_root"].mkdir(parents=True, exist_ok=True)
    run_paths["log_path"].parent.mkdir(parents=True, exist_ok=True)
    run_paths["screenshots_root"].mkdir(parents=True, exist_ok=True)
    run_paths["artifacts_root"].mkdir(parents=True, exist_ok=True)
    return run_paths


def append_install_log(message: str) -> None:
    ensure_shared_layout()
    with INSTALL_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"[{utc_now()}] {message}\n")


def append_run_log(run_id: str, message: str) -> None:
    run_paths = ensure_run_layout(run_id)
    with run_paths["log_path"].open("a", encoding="utf-8") as handle:
        handle.write(f"[{utc_now()}] {message}\n")


def write_heartbeat(
    status: str = "idle",
    task_name: str = "waiting_for_task",
    run_id: str = "",
) -> None:
    ensure_shared_layout()

    payload = {
        "agent": {
            "name": AGENT_NAME,
            "status": status,
            "taskName": task_name,
            "intervalSeconds": HEARTBEAT_INTERVAL_SECONDS,
            "version": AGENT_VERSION,
            "runId": run_id,
        },
        "machine": {
            "computerName": socket.gethostname(),
            "username": getpass.getuser(),
            "timestampUtc": utc_now(),
            "sharedRoot": str(SHARED_ROOT),
            "platform": platform.platform(),
        },
        "prototype": {
            "notes": [
                "Agent booted successfully.",
                "Shared folder detected.",
                "Task and result files are now run-scoped.",
            ]
        },
    }

    with HEARTBEAT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def read_current_run() -> dict | None:
    if not CURRENT_RUN_POINTER_PATH.exists():
        return None

    try:
        with CURRENT_RUN_POINTER_PATH.open("r", encoding="utf-8") as handle:
            raw_value = handle.read().strip()
        return json.loads(raw_value) if raw_value else None
    except Exception as exc:
        append_install_log(f"Failed to read current run pointer: {exc}")
        return None


def read_task() -> dict | None:
    current_run = read_current_run()
    run_id = current_run.get("runId") if current_run else None

    if not run_id:
        return None

    run_paths = ensure_run_layout(run_id)
    task_path = run_paths["task_path"]

    if not task_path.exists():
        return None

    try:
        with task_path.open("r", encoding="utf-8") as handle:
            task = json.load(handle)
        task.setdefault("runId", run_id)
        return task
    except Exception as exc:
        append_install_log(f"Failed to read task file for {run_id}: {exc}")
        return None


def write_task(task: dict) -> None:
    run_id = str(task.get("runId") or "")
    if not run_id:
        return

    run_paths = ensure_run_layout(run_id)
    with run_paths["task_path"].open("w", encoding="utf-8") as handle:
        json.dump(task, handle, indent=2)


def write_result(task: dict, status: str, message: str) -> None:
    run_id = str(task.get("runId") or "")
    task_id = str(task.get("taskId") or "unknown-task")

    if not run_id:
        return

    run_paths = ensure_run_layout(run_id)
    result = {
        "runId": run_id,
        "taskId": task_id,
        "status": status,
        "finishedUtc": utc_now(),
        "message": message,
        "artifacts": {},
    }

    with run_paths["result_path"].open("w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)


def handle_task(task: dict) -> None:
    task_id = str(task.get("taskId") or "unknown-task")
    task_type = str(task.get("taskType") or "unknown")
    run_id = str(task.get("runId") or "")

    if not run_id:
        append_install_log("Skipping task because it does not declare a runId.")
        return

    append_install_log(f"Received task {task_id} of type {task_type} for run {run_id}")
    append_run_log(run_id, f"Received task {task_id} of type {task_type}")

    task["status"] = "running"
    task["startedUtc"] = utc_now()
    write_task(task)
    write_heartbeat(status="running", task_name=task_type, run_id=run_id)

    if task_type == "noop":
        write_result(task, "completed", "No-op task completed.")
    else:
        write_result(task, "completed", f"Prototype agent acknowledged task type: {task_type}")

    task["status"] = "completed"
    task["completedUtc"] = utc_now()
    write_task(task)
    append_run_log(run_id, f"Task {task_id} completed.")
    write_heartbeat(status="idle", task_name="waiting_for_task")


def main() -> None:
    ensure_shared_layout()
    append_install_log("Agent startup begin")
    append_install_log(f"Shared folder found at {SHARED_ROOT}")
    append_install_log("Heartbeat loop started")

    while True:
        try:
            write_heartbeat()

            task = read_task()
            if task and task.get("status") == "queued":
                handle_task(task)

            time.sleep(HEARTBEAT_INTERVAL_SECONDS)
        except Exception as exc:
            append_install_log(f"Agent loop error: {exc}")
            time.sleep(10)


if __name__ == "__main__":
    main()

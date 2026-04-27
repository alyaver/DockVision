#!/usr/bin/env python3
"""
DockVision guest-side Notepad proof task.

This is the preferred Python path for the spike when Python and pywinauto are
available inside the Windows guest. The PowerShell agent falls back to its own
Windows UI automation if this script or dependency is not available yet.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_payload(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as handle:
        raw = handle.read().strip()

    return json.loads(raw) if raw else {}


def bool_payload(payload: dict[str, Any], key: str, default: bool) -> bool:
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def int_payload(payload: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def default_text(task_id: str) -> str:
    return "\r\n".join(
        [
            "DockVision Notepad proof of concept",
            f"Task: {task_id}",
            f"UTC: {utc_now()}",
            "Typed through pywinauto inside the Windows guest.",
        ]
    )


def send_text_human_like(text: str, delay_ms: int) -> None:
    from pywinauto.keyboard import send_keys

    delay_seconds = max(delay_ms, 0) / 1000

    for character in text:
        if character == "\r":
            continue
        if character == "\n":
            send_keys("{ENTER}")
        elif character == "\t":
            send_keys("{TAB}")
        else:
            send_keys(character, with_spaces=True)

        if delay_seconds:
            time.sleep(delay_seconds)


def relative_artifact_path(run_root: Path, target: Path) -> str:
    return target.relative_to(run_root).as_posix()


def run_notepad_task(run_root: Path, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        from pywinauto import Application
        from pywinauto.keyboard import send_keys
    except ImportError as exc:
        raise RuntimeError("pywinauto is not installed in the Windows guest") from exc

    text = str(payload.get("text") or default_text(task_id))
    delay_ms = int_payload(payload, "typingDelayMs", 35)
    capture_screenshot = bool_payload(payload, "captureScreenshot", True)
    save_file = bool_payload(payload, "saveFile", False)
    close_after = bool_payload(payload, "closeAfter", False)

    screenshot_dir = run_root / "screenshots"
    artifacts_dir = run_root / "artifacts"
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    app = Application(backend="uia").start("notepad.exe")
    window = app.window(title_re=".*Notepad.*")
    window.wait("visible ready", timeout=20)
    window.set_focus()
    time.sleep(0.5)

    try:
        editor = window.child_window(control_type="Edit")
        editor.wait("ready", timeout=5)
        editor.click_input()
    except Exception:
        window.click_input()

    send_text_human_like(text, delay_ms)
    time.sleep(0.5)

    artifacts: dict[str, str] = {}
    details: dict[str, Any] = {
        "automationBackend": "python-pywinauto",
        "typedCharacterCount": len(text),
        "typingDelayMs": delay_ms,
        "windowTitle": window.window_text(),
        "saveRequested": save_file,
        "closeRequested": close_after,
    }

    if capture_screenshot:
        screenshot_path = screenshot_dir / f"notepad-{task_id}.png"
        try:
            image = window.capture_as_image()
            image.save(screenshot_path)
            artifacts["screenshot"] = relative_artifact_path(run_root, screenshot_path)
        except Exception as exc:
            details["screenshotWarning"] = str(exc)

    if save_file:
        file_name = str(payload.get("fileName") or f"dockvision-notepad-{task_id}.txt")
        save_path = artifacts_dir / file_name
        send_keys("^s")
        time.sleep(0.8)
        send_keys(str(save_path), with_spaces=True)
        send_keys("{ENTER}")
        time.sleep(0.8)
        relative_save_path = relative_artifact_path(run_root, save_path)
        artifacts["savedFile"] = relative_save_path
        details["savedFile"] = relative_save_path

    if close_after:
        send_keys("%{F4}")
        time.sleep(0.8)

    return {
        "runId": run_root.name,
        "taskId": task_id,
        "status": "completed",
        "finishedUtc": utc_now(),
        "message": "Notepad focused and typed through pywinauto.",
        "artifacts": artifacts,
        "details": details,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the DockVision Notepad proof task.")
    parser.add_argument("--run-root")
    parser.add_argument("--shared-root")
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--payload-file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    run_root_value = args.run_root or args.shared_root
    if not run_root_value:
        raise SystemExit("A run root path is required.")

    run_root = Path(run_root_value)
    payload_path = Path(args.payload_file) if args.payload_file else None

    try:
        payload = read_payload(payload_path)
        result = run_notepad_task(run_root, args.task_id, payload)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        result = {
            "runId": run_root.name,
            "taskId": args.task_id,
            "status": "failed",
            "finishedUtc": utc_now(),
            "message": str(exc),
            "artifacts": {},
            "details": {
                "automationBackend": "python-pywinauto",
                "errorType": type(exc).__name__,
            },
        }
        print(json.dumps(result, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())

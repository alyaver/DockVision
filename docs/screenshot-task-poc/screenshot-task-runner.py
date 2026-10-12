#!/usr/bin/env python3
"""Native Windows starter for JSON-driven screenshot tasks."""

from __future__ import annotations

import argparse
import ctypes
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent

# Keep only the two named controls needed by this proof of concept.
NOTEPAD_TARGETS = {
    "editor": [
        {"title": "Text Editor", "control_type": "Edit"},
        {"control_type": "Document"},
        {"control_type": "Edit"},
    ],
    "editMenu": [
        {"title": "Edit", "control_type": "MenuItem"},
        {"title": "Edit", "control_type": "Button"},
    ],
}


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def resolve_demo_path(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else SCRIPT_DIR / path


def open_app(app_config: dict[str, Any], timeout_seconds: int) -> Any:
    """Open a blank document and return its native Notepad window."""
    from pywinauto import Application, Desktop

    if str(app_config.get("name", "notepad")).lower() != "notepad":
        raise ValueError("This starter supports only Notepad.")

    target_file = resolve_demo_path(app_config.get("fileName", "screenshot-task-test.txt"))
    if app_config.get("uniqueFilePerRun", True):
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        target_file = target_file.with_name(f"{target_file.stem}-{timestamp}{target_file.suffix}")

    target_file.parent.mkdir(parents=True, exist_ok=True)
    if app_config.get("resetFile", True) or not target_file.exists():
        target_file.write_text("", encoding="utf-8")

    executable = app_config.get("executable", "notepad.exe")
    Application(backend="uia").start(f'"{executable}" "{target_file}"')

    # Desktop lookup also works when modern Notepad hands off to another process.
    window_spec = Desktop(backend="uia").window(title_re=rf".*{re.escape(target_file.stem)}.*")
    window_spec.wait("exists visible ready", timeout=timeout_seconds)
    window = window_spec.wrapper_object()

    bounds = app_config.get("windowBounds")
    if bounds:
        moved = ctypes.windll.user32.MoveWindow(
            window.handle, int(bounds["x"]), int(bounds["y"]),
            int(bounds["width"]), int(bounds["height"]), True,
        )
        if not moved:
            raise RuntimeError("Unable to position the Notepad window.")

    window.set_focus()
    time.sleep(0.3)
    return window


def resolve_named_control(window: Any, target_name: str, timeout_seconds: int) -> Any:
    """Try a few UIA descriptions for the requested named control."""
    candidates = NOTEPAD_TARGETS.get(target_name)
    if not candidates:
        raise ValueError(f"Unknown target: {target_name}")

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        for candidate in candidates:
            for control in window.descendants(**candidate):
                if control.is_visible() and control.is_enabled():
                    return control
        time.sleep(0.1)

    raise RuntimeError(f"Could not find Notepad target '{target_name}'.")


def click_target(window: Any, step: dict[str, Any], timeout_seconds: int) -> None:
    window.set_focus()
    control = resolve_named_control(window, step["target"], timeout_seconds)
    rect = control.rectangle()
    x = round((rect.right - rect.left) * float(step.get("xPercent", 50)) / 100)
    y = round((rect.bottom - rect.top) * float(step.get("yPercent", 50)) / 100)
    for _ in range(max(int(step.get("clickCount", 1)), 1)):
        control.click_input(button=step.get("button", "left"), coords=(x, y))


def send_text_human_like(text: str, delay_ms: int) -> None:
    from pywinauto.keyboard import send_keys

    for character in text:
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
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)


def take_screenshot(file_name: str) -> None:
    """Add screenshot capture and PNG saving here. No files are created yet."""

    from PIL import ImageGrab

    screenshot = ImageGrab.grab()

    print(f"Image object: {screenshot}")
    print(f"Image size: {screenshot.size}")
    print(f"Image format: {screenshot.mode}")
    print(f"Target file: {file_name}")

    screenshot.save(file_name, format="PNG")


def execute_plan(plan: dict[str, Any]) -> None:
    settings = plan.get("settings", {})
    timeout_seconds = int(settings.get("timeoutSeconds", 20))
    typing_delay_ms = int(settings.get("typingDelayMs", 22))
    step_delay_ms = int(settings.get("stepDelayMs", 225))
    window = open_app(plan.get("app", {}), timeout_seconds)

    for step in plan.get("tasks", []):
        action = str(step.get("action", "")).upper()
        print(f"{step.get('id', 'step')}: {action}")

        if action == "CLICK":
            click_target(window, step, timeout_seconds)
        elif action == "TYPE":
            window.set_focus()
            send_text_human_like(step["text"], typing_delay_ms)
        elif action == "WAIT":
            time.sleep(max(int(step.get("delayMs", step_delay_ms)), 0) / 1000)
        elif action == "SCREENSHOT":
            take_screenshot(step["fileName"])
        else:
            raise ValueError(f"Unsupported action '{action}'.")

        if step_delay_ms > 0:
            time.sleep(step_delay_ms / 1000)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", default=str(SCRIPT_DIR / "screenshot-task-plan.json"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        execute_plan(read_json(resolve_demo_path(args.plan)))
        print("Task sequence finished. Screenshot capture is still a placeholder.")
        return 0
    except Exception as exc:
        print(f"Task sequence failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
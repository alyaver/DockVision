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
import json
import re
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path
from typing import Any


# The demo is intentionally self-contained. All relative files, generated
# Notepad documents, and artifacts live beside this runner.
SCRIPT_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = SCRIPT_DIR / "artifacts"

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


def write_top_level_windows_snapshot(output_path: Path, title: str) -> dict[str, Any]:
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
        "path": str(output_path.relative_to(SCRIPT_DIR)),
        "windowCount": len(windows),
    }


def wait_for_win32_font_dialog(timeout_seconds: int) -> dict[str, Any] | None:
    """
    Find the classic Font dialog through Win32 instead of UIA.

    The VM showed the Font dialog visually while UIA still timed out waiting for
    a wrapper named "Font". The native dialog has a stable #32770 class, so this
    path is better for classic Windows dialogs.
    """

    deadline = time.time() + max(timeout_seconds, 1)
    while time.time() < deadline:
        for window in list_visible_top_level_windows():
            if window["title"].casefold() == "font" and window["className"] == "#32770":
                return window
        time.sleep(0.2)

    return None


def focus_win32_window(hwnd: int) -> None:
    """Bring a native window to the foreground before sending keyboard input."""

    ctypes.windll.user32.ShowWindow(hwnd, 9)
    ctypes.windll.user32.SetForegroundWindow(hwnd)
    time.sleep(0.2)


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
def write_control_tree(window: Any, output_path: Path, limit: int = 300) -> dict[str, Any]:
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
        "path": str(output_path.relative_to(SCRIPT_DIR)),
        "controlCount": len(controls),
    }


def write_control_snapshot(root_control: Any, output_path: Path, title: str, limit: int = 300) -> dict[str, Any]:
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
        "path": str(output_path.relative_to(SCRIPT_DIR)),
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


def find_global_control_by_candidate(candidate: dict[str, Any], timeout_seconds: int) -> Any | None:
    """
    Search all top-level UIA windows for a transient control.

    Classic Notepad's Format menu popup is not a stable descendant of the main
    Notepad window, so dialog/menu automation needs a desktop-wide lookup.
    """

    from pywinauto import Desktop
    from pywinauto.keyboard import send_keys

    found_index = int_value(candidate.get("foundIndex"), 0)
    deadline = time.time() + max(timeout_seconds, 1)

    while time.time() < deadline:
        try:
            matches: list[Any] = []
            for top_window in Desktop(backend="uia").windows():
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

        time.sleep(0.25)

    return None


def find_control_by_candidates(window: Any, candidates: list[dict[str, Any]], timeout_seconds: int) -> tuple[Any | None, dict[str, Any] | None, list[dict[str, Any]]]:
    """Try several UIA candidate shapes and report exactly what was attempted."""

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_control_by_candidate(window, candidate, timeout_seconds)
        if control is not None:
            return control, candidate, attempted

    return None, None, attempted


def find_global_control_by_candidates(candidates: list[dict[str, Any]], timeout_seconds: int) -> tuple[Any | None, dict[str, Any] | None, list[dict[str, Any]]]:
    """Try several desktop-wide UIA candidates for pop-up menus and dialogs."""

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_global_control_by_candidate(candidate, timeout_seconds)
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
def find_control_by_candidate(window: Any, candidate: dict[str, Any], timeout_seconds: int) -> Any | None:
    found_index = int_value(candidate.get("foundIndex"), 0)
    deadline = time.time() + max(timeout_seconds, 1)

    while time.time() < deadline:
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

        time.sleep(0.25)

    return None


# Resolve a user-facing target name such as "notepad.fileMenu" to a real
# pywinauto control. This is the heart of the named-control architecture.
def resolve_named_control(window: Any, named_targets: dict[str, Any], target_name: str, timeout_seconds: int) -> tuple[Any, dict[str, Any]]:
    target_definition = named_targets.get(target_name)
    if not target_definition:
        raise ValueError(f"Unknown named target: {target_name}")

    candidates = target_definition.get("candidates") or []
    if not candidates:
        raise ValueError(f"Named target '{target_name}' does not define any candidates.")

    attempted: list[dict[str, Any]] = []
    for candidate in candidates:
        attempted.append(candidate)
        control = find_control_by_candidate(window, candidate, timeout_seconds)
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
def resolve_click_target(active_window: Any, named_targets: dict[str, Any], target: dict[str, Any], timeout_seconds: int) -> dict[str, Any]:
    target_type = str(target.get("type") or "namedControl")

    if target_type == "namedControl":
        target_name = str(target.get("name") or "")
        if not target_name:
            raise ValueError("CLICK target.type 'namedControl' requires target.name.")

        control, target_info = resolve_named_control(active_window, named_targets, target_name, timeout_seconds)
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
def send_text_human_like(text: str, delay_ms: int) -> None:
    from pywinauto.keyboard import send_keys

    delay_seconds = max(delay_ms, 0) / 1000.0

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

        if delay_seconds:
            time.sleep(delay_seconds)


def set_classic_notepad_font_style(
    active_window: Any,
    named_targets: dict[str, Any],
    style: str,
    timeout_seconds: int,
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

    active_window.set_focus()
    format_control, format_target_info = resolve_named_control(
        active_window,
        named_targets,
        "formatMenu",
        timeout_seconds,
    )
    format_click = click_control_center(format_control)
    time.sleep(0.25)

    font_menu_item, font_menu_candidate, font_menu_attempted = find_global_control_by_candidates(
        [
            {"titleRegex": r"^Font", "controlType": "MenuItem"},
            {"titleRegex": r"^Font"},
        ],
        dialog_lookup_timeout,
    )
    if font_menu_item is None:
        send_keys("f")
        font_menu_click = {
            "fallback": "formatMenuAccessKey",
            "keys": "f",
            "attempted": font_menu_attempted,
        }
    else:
        font_menu_click = click_control_center(font_menu_item)
        font_menu_click["matchedCandidate"] = font_menu_candidate

    time.sleep(0.5)

    dialog_window = wait_for_win32_font_dialog(dialog_lookup_timeout + 3)
    top_level_snapshot = write_top_level_windows_snapshot(
        ARTIFACT_DIR / f"top-level-windows-before-font-{normalized_style.casefold().replace(' ', '-')}.txt",
        f"DockVision top-level windows before selecting {normalized_style}",
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
        focus_win32_window(int(dialog_window["hwnd"]))
        dialog_focus = {
            "hwnd": dialog_window["hwnd"],
            "title": dialog_window["title"],
            "className": dialog_window["className"],
            "rectangle": dialog_window["rectangle"],
        }

        try:
            font_dialog = Desktop(backend="uia").window(handle=int(dialog_window["hwnd"])).wrapper_object()
            dialog_snapshot = write_control_snapshot(
                font_dialog,
                ARTIFACT_DIR / f"font-dialog-{normalized_style.casefold().replace(' ', '-')}.txt",
                f"DockVision Font dialog snapshot before selecting {normalized_style}",
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
    send_keys("%y")
    time.sleep(0.1)
    send_keys("^a")
    time.sleep(0.05)
    send_keys(normalized_style, with_spaces=True)
    time.sleep(0.1)
    send_keys("%o")
    time.sleep(0.4)

    ok_confirm = {
        "method": "keyboardAccessKeys",
        "keys": keys_sent,
    }

    if dialog_window is not None and is_win32_window_visible(int(dialog_window["hwnd"])):
        send_keys("{ENTER}")
        ok_confirm["fallback"] = "enterAfterAltO"
        ok_confirm["fallbackKey"] = "{ENTER}"
        time.sleep(0.4)

    if dialog_window is not None and is_win32_window_visible(int(dialog_window["hwnd"])):
        raise RuntimeError(f"Font dialog did not close after selecting {normalized_style}.")

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
def open_app(step: dict[str, Any], timeout_seconds: int) -> dict[str, Any]:
    from pywinauto import Application, Desktop

    executable = str(step.get("executable") or "notepad.exe")
    target_file = resolve_demo_path(step.get("fileName"))

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

    Application(backend="uia").start(command_line)

    window_spec = Desktop(backend="uia").window(title_re=title_regex)
    window_spec.wait("exists visible ready", timeout=timeout_seconds)
    window = window_spec.wrapper_object()

    bounds = step.get("windowBounds") or {}
    if bounds:
        move_window_with_win32(window, bounds)
        time.sleep(0.5)

    window.set_focus()
    time.sleep(0.3)

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


# Main interpreter loop. Each JSON step becomes one concrete runner action.
# This mirrors the architecture we eventually want in the DockVision inner
# agent: read a plan, execute each task, and collect structured results.
def execute_plan(plan: dict[str, Any]) -> dict[str, Any]:
    from pywinauto import mouse
    from pywinauto.keyboard import send_keys

    settings = plan.get("settings") or {}
    timeout_seconds = int_value(settings.get("timeoutSeconds"), 20)
    step_delay_ms = int_value(settings.get("stepDelayMs"), 250)
    typing_delay_ms = int_value(settings.get("typingDelayMs"), 25)
    app_config = app_config_from_plan(plan)
    named_targets = named_targets_for_app(app_config)

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    # Startup is runner-owned now. The user-authored JSON task list should not
    # have to include OPEN_APP or INSPECT just to make CLICK/TYPE possible.
    opened = open_app(app_config, timeout_seconds)
    active_window = opened["window"]
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
    control_tree_path = ARTIFACT_DIR / "control-tree.txt"
    inspect_result = write_control_tree(active_window, control_tree_path)
    artifacts["controlTree"] = inspect_result["path"]
    startup_result["inspect"] = inspect_result

    for step in plan.get("tasks") or plan.get("steps") or []:
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
            )
            button = str(step.get("button") or "left").lower()
            click_count = max(int_value(step.get("clickCount"), 1), 1)
            coords = (resolved["point"]["x"], resolved["point"]["y"])

            for index in range(click_count):
                mouse.click(button=button, coords=coords)
                if index < click_count - 1:
                    time.sleep(0.1)

            step_result["button"] = button
            step_result["clickCount"] = click_count
            step_result["resolvedTarget"] = resolved

        elif action == "TYPE":
            # TYPE assumes a previous CLICK or focus operation put the caret in
            # the right control. The click contract and type contract stay
            # separate so Task-i-fy can generate them independently.
            active_window.set_focus()
            text = str(step.get("text") or "")
            send_text_human_like(text, typing_delay_ms)
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
            time.sleep(max(delay_ms, 0) / 1000.0)
            step_result["delayMs"] = delay_ms

        else:
            raise RuntimeError(f"Unsupported action '{action}' in step '{step_id}'.")

        steps_result.append(step_result)

        if step_delay_ms > 0:
            time.sleep(step_delay_ms / 1000.0)

    return {
        "status": "completed",
        "planName": plan.get("name"),
        "finishedAt": datetime.now().isoformat(),
        "automationBackend": "python-pywinauto-uia",
        "openedFile": opened_file,
        "artifacts": artifacts,
        "startup": startup_result,
        "steps": steps_result,
    }


# CLI boundary. The runner defaults to the task plan beside itself, but accepts
# --plan so teammates can try alternate contracts without editing this file.
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run DockVision pywinauto named-control demo.")
    parser.add_argument("--plan", default=str(SCRIPT_DIR / "task-plan.json"), help="Path to task-plan.json")
    return parser.parse_args()


# Program entry point. Always write result.json, even on failure, because the
# failure artifact is usually the fastest way to understand what went wrong.
def main() -> int:
    args = parse_args()
    plan_path = Path(args.plan)
    result_path = ARTIFACT_DIR / "result.json"

    try:
        plan = read_json(plan_path)
        result = execute_plan(plan)
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


if __name__ == "__main__":
    sys.exit(main())

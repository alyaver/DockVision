# DockVision VM Notepad pywinauto Demo

This demo is the VM-focused clone of `docs/pywinauto-control-demo`.

The original demo is useful on the developer desktop, where newer Notepad builds
may expose toolbar controls such as Bold and Italic. The DockVision Windows VM
currently runs classic Notepad, whose UIA tree exposes:

```text
editor
fileMenu
editMenu
formatMenu
viewMenu
helpMenu
```

Classic Notepad does not expose Bold or Italic toolbar buttons, so this folder
keeps the same three-test shape but uses only VM-safe controls.

```text
vm-notepad-runner.py = VM-safe pywinauto/UIA interpreter and classic Notepad target registry
vm-user-test-1-font-dialog.json = type 25 names while alternating Format -> Font -> Regular/Italic
vm-user-test-2-menu-cycle.json = click File, Edit, View for three cycles
vm-user-test-3-mixed-workflow.json = mixed File/Edit/Format/View/Help, typing, and right-click flow
```

## DockVision Upload

Use this folder when testing through the VM-backed DockVision app:

```text
Runner: docs/pywinauto-vm-notepad-demo/vm-notepad-runner.py
Task plan: docs/pywinauto-vm-notepad-demo/vm-user-test-1-font-dialog.json
```

`vm-user-test-2-menu-cycle.json` is the safest smoke test because it already
matched the VM control tree. `vm-user-test-1-font-dialog.json` is the VM-safe
replacement for the earlier Italic-button test: it opens classic Notepad's Font
dialog and alternates the editor-wide display style between Regular and Italic.

The distinct `vm-*` filenames are intentional. The desktop demo also has files
called `runner.py` and `user-test-1.json`, and DockVision currently displays
only the base filename after upload.

Classic Notepad is plain text. The alternating font style is visible while the
runner changes the editor display, but the saved `.txt` file does not preserve
rich per-line italic formatting.

## Local Run

From this folder:

```powershell
python .\runner.py --plan .\user-test-1.json
python .\runner.py --plan .\user-test-2.json
python .\runner.py --plan .\user-test-3.json
```

Or double-click:

```text
user-test-1.bat
user-test-2.bat
user-test-3.bat
```

## Output

The runner writes:

```text
artifacts/control-tree.txt
artifacts/result.json
```

Use `control-tree.txt` when adding new VM-safe named targets.

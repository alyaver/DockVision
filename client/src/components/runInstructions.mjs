export const BUILT_IN_TASK_PLAN_EXAMPLE = `{
  "schemaVersion": "dockvision.user-task-plan.v1",
  "name": "Notepad example",
  "app": { "name": "notepad", "executable": "notepad.exe" },
  "tasks": [
    { "id": "click-editor", "action": "CLICK", "target": "editor" },
    { "id": "type-message", "action": "TYPE", "text": "Hello from DockVision" }
  ]
}`;

export const PYTHON_RUNNER_COMMAND = "python.exe <runner-script> --plan <task-plan>";
export const POWERSHELL_RUNNER_COMMAND = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File <runner-script> -ConfigPath <task-plan>";

export const AI_RUNNER_PROMPT = `Create a DockVision Python runner. It must accept --plan <path>, read the JSON file at that supplied path, perform the requested automation inside the Windows guest, print one structured JSON result object to stdout with status "completed" on success, and exit with a nonzero code on failure. Do not use a path from the developer's computer or require the user to install guest dependencies.`;
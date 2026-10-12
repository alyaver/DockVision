import {
  AI_RUNNER_PROMPT,
  BUILT_IN_TASK_PLAN_EXAMPLE,
  POWERSHELL_RUNNER_COMMAND,
  PYTHON_RUNNER_COMMAND,
} from "./runInstructions.mjs";
import "./RunInstructions.css";

function HelpSection({ title, children, open = false }) {
  return (
    <details className="run-instructions-section" open={open}>
      <summary>{title}</summary>
      <div className="run-instructions-content">{children}</div>
    </details>
  );
}

export function RunInstructions({ mode = "custom", location = "dashboard", onModeChange }) {
  const isBuiltIn = mode === "builtin";

  return (
    <section className={`run-instructions run-instructions--${location}`} aria-labelledby={`${location}-instructions-title`}>
      <div className="run-instructions-heading">
        <div>
          <p className="run-instructions-eyebrow">Before your Test Run</p>
          <h2 id={`${location}-instructions-title`}>How DockVision uses your files</h2>
        </div>
        <p className="run-instructions-summary">
          {isBuiltIn
            ? "Built-In Notepad uses a Task Plan to perform supported Notepad actions."
            : "Custom Runner uses your Runner Script to interpret a Task Plan inside the Windows guest."}
        </p>
      </div>

      {location === "dashboard" && (
        <div className="run-instructions-mode-grid">
          <button
            className={`run-mode-summary ${isBuiltIn ? "run-mode-summary--selected" : ""}`}
            type="button"
            aria-pressed={isBuiltIn}
            onClick={() => onModeChange?.("builtin")}
          >
            <h3>Built-In Notepad</h3>
            <p>Choose this for supported standard Notepad workflows using ordered TYPE and CLICK actions.</p>
            <strong>Required: one JSON Task Plan. No Runner Script.</strong>
          </button>
          <button
            className={`run-mode-summary ${!isBuiltIn ? "run-mode-summary--selected" : ""}`}
            type="button"
            aria-pressed={!isBuiltIn}
            onClick={() => onModeChange?.("custom")}
          >
            <h3>Custom Runner</h3>
            <p>Choose this when you need custom Python or PowerShell logic to interpret the plan.</p>
            <strong>Required: one .py or .ps1 Runner Script and one JSON Task Plan.</strong>
          </button>
        </div>
      )}

      <HelpSection title={`${isBuiltIn ? "Built-In Notepad" : "Custom Runner"} file and workflow details`} open={location !== "dashboard"}>
        {isBuiltIn ? (
          <>
            <p>Create or upload a JSON Task Plan. DockVision validates the plan, copies it into the isolated Test Run folder, and runs its supported actions in order. Do not upload a Python or PowerShell Runner Script for this mode.</p>
            <p>Use Custom Runner instead when the workflow needs custom code, external logic, or actions outside the supported Notepad plan.</p>
            <pre><code>{BUILT_IN_TASK_PLAN_EXAMPLE}</code></pre>
          </>
        ) : (
          <>
            <p>DockVision copies the uploaded Runner Script and Task Plan into an isolated Test Run folder. The original filename is retained as metadata; the guest executes the copied runner file for that run.</p>
            <ul>
              <li>Python: <code>{PYTHON_RUNNER_COMMAND}</code></li>
              <li>PowerShell: <code>{POWERSHELL_RUNNER_COMMAND}</code></li>
            </ul>
            <p>Your Runner Script interprets the Task Plan and performs the automation. Read the path supplied by the command-line contract or derive paths from it; do not rely on a path from the user&apos;s computer.</p>
          </>
        )}
      </HelpSection>

      {(!isBuiltIn || location === "confirmation") && (
        <HelpSection title="What is my .py script looking for?">
          <ol>
            <li>Accept <code>--plan</code> and read the JSON file at that supplied path.</li>
            <li>Interpret the plan and perform the requested automation in the Windows guest.</li>
            <li>Print a structured JSON result to standard output. If the result includes a status, a successful run must report <code>status: &quot;completed&quot;</code>.</li>
            <li>Return a nonzero exit code when execution fails.</li>
          </ol>
          <p>The same responsibilities apply to PowerShell with the <code>-ConfigPath</code> parameter. The guest runtime provides Python and pywinauto setup; normal users should not install those dependencies manually.</p>
        </HelpSection>
      )}

      {location !== "configuration" && (
        <HelpSection title="Prompt an AI assistant for a compatible runner">
          <p>Give the assistant the actual DockVision contract instead of asking for a generic script:</p>
          <pre><code>{AI_RUNNER_PROMPT}</code></pre>
        </HelpSection>
      )}

      <HelpSection title="Common troubleshooting">
        <dl>
          <dt>Python is not available inside the Windows guest</dt>
          <dd>The guest runtime is still provisioning or is not ready. Wait for the VM/agent and retry; do not manually install Python.</dd>
          <dt>Runner script or Task Plan was not found</dt>
          <dd>Verify that the required upload succeeded. A custom Runner Script must use the supplied plan path and the run-local files.</dd>
          <dt>Runner failed with exit code 1</dt>
          <dd>The script started but reported failure. Inspect the Test Run logs and runner output.</dd>
          <dt>Invalid Task Plan</dt>
          <dd>The JSON is malformed or does not match the supported Built-In Task Plan contract.</dd>
        </dl>
      </HelpSection>
    </section>
  );
}

export default RunInstructions;
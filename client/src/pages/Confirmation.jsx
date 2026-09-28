import Navigation from "../components/Navigation";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../confirmationPage.css";
import { startTestRun } from "../lib/api";
import { launchWhenReady } from "../lib/launchWhenReady.mjs";
import { config } from "dotenv";

/**
 * Confirmation rehydrates from sessionStorage so a refresh or direct navigation
 * does not discard the run details selected on the Dashboard.
 */

const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";

function readStoredRun() {
  try {
    const rawValue = sessionStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function writeStoredRun(nextValues) {
  const existingRun = readStoredRun() ?? {};
  const updatedRun = { ...existingRun, ...nextValues };
  sessionStorage.setItem(CURRENT_RUN_STORAGE_KEY, JSON.stringify(updatedRun));
}

const DisplayCard = ({ title, content }) => (
  <div className="Display-Card">
    <div className="Card-Title">{title}</div>
    <div className="Card-Container">
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  </div>
);

const Confirmation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const storedRun = readStoredRun();

  // Remembers which mode user picked (custom runner or built in notepad)
  const executionMode =
    location.state?.executionMode ?? // Use the mode sent by dashboard
    storedRun?.executionMode ?? // if dashboard did not send a mode check storedRun (sessionStorage)
    "custom"; // if nothing was picked, then default to custom runner

  // read settings saved by configuration settings
  const savedOptions = storedRun?.runOptions;

  // use the saved settings, if no settings were saved use handbook default
  const runOptions = {
    iterations: savedOptions?.iterations ?? 1,
    captureIntervalSeconds: savedOptions?.captureIntervalSeconds ?? 5,
    iterationTimeoutSeconds: savedOptions?.iterationTimeoutSeconds ?? 300,
  }

  const testName =
    location.state?.testName || storedRun?.testName || "Untitled Test Run";
  // Prefer route state from Dashboard, then fall back to sessionStorage so a
  // refresh keeps the selected runner source available for preview and submit.
  const runnerScriptName =
    location.state?.runnerScriptName ||
    storedRun?.runnerScriptName ||
    "No runner script uploaded";
  const runnerScriptContent =
    location.state?.runnerScriptContent ||
    storedRun?.runnerScriptContent ||
    "No runner script content available";
  const runnerScriptLanguage =
    location.state?.runnerScriptLanguage ||
    storedRun?.runnerScriptLanguage ||
    "powershell";
  const configFileName =
    location.state?.configFileName ||
    storedRun?.configFileName ||
    "No config uploaded";
  const configContent =
    location.state?.configContent ||
    storedRun?.configContent ||
    "No config content available";

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function handleConfirm() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      /**
       * Start the run through the shared API helper so this page stays aligned
       * with backend launch changes. The runner content is included so the
       * backend can persist and execute the selected .py/.ps1 runner.
       */

      // information needed by both custom runner and built in notepad
      const request = {
        executionMode,
        testName,
        configFileName,
        configContent,
        runOptions,
      };

      // includes the uploaded runner if Custom Runner was selected
      if (executionMode === "custom") {
        request.runnerScriptName = runnerScriptName;
        request.runnerScriptContent = runnerScriptContent;
        request.runnerScriptLanguage = runnerScriptLanguage;
      }

      const data = await launchWhenReady(request, {
        launch: startTestRun,
        onProgress: setProgressMessage,
        signal: controller.signal,
      });

      // Keep the submitted runner source next to the returned run identifiers
      // so the Running Test flow survives refreshes during local development.
      writeStoredRun({
        runId: data.runId || null,
        containerId: data.containerId || null,
        testName,
        runnerScriptName,
        runnerScriptContent,
        runnerScriptLanguage,
        configFileName,
        configContent,
        executionMode,
        runOptions,
      });

      const runId = data.runId || data.run?.runId || null;

      navigate(`/running-test/${runId}`, {
        state: {
          runId,
          containerId: data.containerId || null,
          testName,
        },
      });
    } catch (error) {
      if (!controller.signal.aborted) setErrorMessage(error.message || "Failed to start test run.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) {
        setIsSubmitting(false);
        setProgressMessage("");
      }
    }
  }

  return (
    <>
      <Navigation />
      <div className="Confirmation-Page">
        <div className="Confirmation-Box">
          <h2 className="Title">You are about to start a new Test Run</h2>
          <p>Confirm the following before proceeding</p>

          <p>
            <strong>Test Run Name:</strong> {testName}
          </p>

          {/* Shows the user which mode they selected */}
          <p>
            <strong>Execution Mode: </strong>
            {executionMode === "builtin" ? "Built-in Notepad" : "Custom Runner"}
          </p>

          {/* Shows the users saved settings, uses default values for missing settings */}
          <div className="run-settings">
            <p>
              <strong>Iterations: </strong>
              {runOptions.iterations}
            </p>

            <p>
              <strong>Screenshot interval: </strong>
              {runOptions.captureIntervalSeconds} second(s)
            </p>

            <p>
              <strong>Timeout per iteration: </strong>
              {runOptions.iterationTimeoutSeconds} seconds
            </p>
          </div>

          <div className="Card-Content">
            {/* Preview the script body, not just the filename, before launch. */}

            {/* only used for Custom Runner (uploaded runner script) */}
            {executionMode === "custom" && (
              <DisplayCard
                title={`Runner Script (${runnerScriptName})`}
                content={runnerScriptContent}
              />
            )}

            <DisplayCard
              title={`Task Plan (${configFileName})`}
              content={configContent}
            />
          </div>

          {progressMessage && <p role="status" aria-live="polite">{progressMessage}</p>}
          {errorMessage && <p role="alert" style={{ color: "red" }}>{errorMessage}</p>}

          <div className="Button-Group">
            {isSubmitting ? (
              <button className="Button Return" disabled>Preparing run…</button>
            ) : (
              <Link to="/dashboard"><button className="Button Return">Return</button></Link>
            )}

            <button
              className="Button Confirm"
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Waiting for readiness…" : errorMessage ? "Retry" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Confirmation;

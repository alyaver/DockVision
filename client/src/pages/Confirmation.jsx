import Navigation from "../components/Navigation";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import "../confirmationPage.css";
import { startTestRun } from "../lib/api";

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

  async function handleConfirm() {
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      /**
       * Start the run through the shared API helper so this page stays aligned
       * with backend launch changes. The runner content is included so the
       * backend can persist and execute the selected .py/.ps1 runner.
       */
      const data = await startTestRun({
        testName,
        runnerScriptName,
        runnerScriptContent,
        runnerScriptLanguage,
        configFileName,
        configContent,
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
      });

      navigate("/running-test", {
        state: {
          runId: data.runId || null,
          containerId: data.containerId || null,
          testName,
        },
      });
    } catch (error) {
      setErrorMessage(error.message || "Failed to start test run.");
    } finally {
      setIsSubmitting(false);
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

          <div className="Card-Content">
            {/* Preview the script body, not just the filename, before launch. */}
            <DisplayCard
              title={`Runner Script (${runnerScriptName})`}
              content={runnerScriptContent}
            />
            <DisplayCard
              title={`Task Plan (${configFileName})`}
              content={configContent}
            />
          </div>

          {errorMessage && <p style={{ color: "red" }}>{errorMessage}</p>}

          <div className="Button-Group">
            <Link to="/dashboard">
              <button className="Button Return">Return</button>
            </Link>

            <button
              className="Button Confirm"
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Starting..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Confirmation;

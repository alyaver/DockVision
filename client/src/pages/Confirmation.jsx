import Navigation from "../components/Navigation";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../confirmationPage.css";
import { startTestRun } from "../lib/api";
import { launchWhenReady } from "../lib/launchWhenReady.mjs";
import {getExportDestination, saveExportDestination, rememberRunExport} from "../lib/exportDestination.mjs";
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
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [exportDirectory, setExportDirectory] = useState(null);
  const [exportMessage, setExportMessage] = useState("");
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [skipAutomaticExport, setSkipAutomaticExport] = useState(false);
  const [exportUserId, setExportUserId] = useState(null);
  const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  
  useEffect(() => {
    let isMounted = true;

    //prevents users from bypassing sign in when adding "/confirmation" in the address bar
    async function verifyAuthentication() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (!response.ok) {
          navigate("/", { replace: true });
          return;
        }
        // Get users id for export folder
        const data = await response.json();
        const userId = data.user?.user_id;

        if(userId == null) {
          if (isMounted) {
            setExportMessage("Unable to verify your account and can't save your preferred export folder.");
          }
          return;
        }

        if (!isMounted) return;
        setExportUserId(userId);

        try {
          // restores the user's previously selected export folder
          const destination = await getExportDestination(userId);

          if (!isMounted) return;

          // restore saved folder
          setExportDirectory(destination?.directory ?? null);
          setSkipAutomaticExport(destination?.enabled === false);
        } catch {
          // allow user to select another folder if they can't access their previously selected folder
          if (isMounted) {
            setExportMessage(
              "Could not restore your export destination. Choose a folder again or opt out and download artifacts manually."
            );
          }
        }

      } catch {
        navigate("/", { replace: true });
      } finally {
        if (isMounted) setIsAuthLoading(false);
      }
    }

    verifyAuthentication();
    return () => { isMounted = false; };
  }, [navigate]);

  // Opens the browser's folder picker and remembers users selected folder
  async function handleChooseExportFolder() {
    // checks to see if browser supports selecting a local folder
    if (typeof window.showDirectoryPicker !== "function") {
      setExportMessage(
        "Automatic folder saving is unavailable in this browser."
      );
      return;
    }

    // makes sure user is identified before saving folder preference
    if (exportUserId == null) {
      setExportMessage(
        "Your account could not be identified. Reload the page and sign in again."
      );
      return;
    }

    setIsChoosingFolder(true);
    setExportMessage("");

    try {
      // requests rw access to selected folder
      const options = {
        mode: "readwrite",
        ...(exportDirectory ? { startIn: exportDirectory } : {})
      };

      const directory = await window.showDirectoryPicker(options);

      // keep selected folder and enable automatic exporting
      setExportDirectory(directory);
      setSkipAutomaticExport(false);

      try {
        // save folder preference so it can be used in the future
        await saveExportDestination(exportUserId, directory);
      } catch {
        setExportMessage(
          "The folder was selected but could not be remembered. Automatic export is not configured yet, you can download them manually."
        );
      }
      // show folder access errors
    } catch (error) {
      if (error.name !== "AbortError") {
        setExportMessage(`Could not access that folder: ${error.message}`);
      }
    } finally {
      setIsChoosingFolder(false);
    }
  }

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

      let exportSetupMessage = "";

      try {
        // remembers which folder to use for the curr test run
        await rememberRunExport(
          exportUserId,
          runId,
          skipAutomaticExport ? null : exportDirectory
        );
      } catch {
        exportSetupMessage = "The test started, but its automatic export choice could not be saved."
      }

      navigate(`/running-test/${runId}`, {
        state: {
          runId,
          containerId: data.containerId || null,
          testName,
          exportSetupMessage,
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

  if (isAuthLoading) {
    return (
      <>
        <Navigation />
        <main className="Auth-Check">
          <p role="status" aria-live="polite">Checking your session...</p>
        </main>
      </>
    );
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

          <div className="export-option">
            <label>
              <input 
                type="checkbox"
                checked={skipAutomaticExport}
                disabled={isSubmitting || isChoosingFolder}
                onChange={(event) => {
                  setSkipAutomaticExport(event.target.checked);
                  setExportMessage("");
                }} 
              />
              Don't automatically save artifacts to my device.
            </label>
            {skipAutomaticExport &&  (
              <p role="status">
                Artifacts will not be automatically saved to this device.
                You can still open and download available artifacts manually.
              </p>
            )}
            <p>Choose a folder to save completed test artifacts.</p>
            {/* users can select or change their export folder */}
            <button
              type="button"
              className="Button"
              onClick={handleChooseExportFolder}
              disabled={isSubmitting || isChoosingFolder || skipAutomaticExport}
            >
              {isChoosingFolder
                ? "Choosing folder..."
                : exportDirectory
                  ? "Change export folder"
                  : "Choose export folder"
              }
            </button>

            {/* show selected folder name */}
            {exportDirectory && (
              <p role="status">Selected folder: {exportDirectory.name}</p>
            )}

            {/* display any folder/export errors */}
            {exportMessage && (
              <p role="status" style={{ color: "red" }}>{exportMessage}</p>
            )}
          </div>

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

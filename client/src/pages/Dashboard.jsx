import Navigation from "../components/Navigation";
import {
  UploadIcon,
  RunIcon,
  SettingsIcon,
  EmptyIcon,
} from "../components/Icons";
import "../Dashboard.css";
import "../NavBar.css";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRun } from "../lib/api";

/**
 * The dashboard owns two pieces of transient user state:
 * - the in-progress run configuration persisted in sessionStorage
 * - launcher readiness signals polled from the backend
 *
 * Keeping both here lets the flow survive refreshes without pushing partially
 * complete run setup into a more global store.
 */


// Prototype runner policy: this execution path reads a task-plan JSON plus a
// Python or PowerShell runner into browser state before API handoff.
const ALLOWED_CONFIG_EXTENSIONS = [".json"];
const ALLOWED_RUNNER_EXTENSIONS = [".py", ".ps1"];
const MAX_RUNNER_SCRIPT_SIZE_BYTES = 256 * 1024;
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

function clearStoredRun() {
  sessionStorage.removeItem(CURRENT_RUN_STORAGE_KEY);
}

function validateTestName(value) {
  if (!value.trim()) {
    return "Test name required.";
  }

  if (value.length > 50) {
    return "Test name must be 50 characters or less.";
  }

  if (!/^[a-zA-Z0-9 ]+$/.test(value)) {
    return "Letters and digits only.";
  }

  return "";
}

// Convert the accepted runner filename into the language label used by the
// future backend/agent script_run contract.
function getRunnerScriptLanguage(fileName) {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".py")) {
    return "python";
  }

  if (normalizedName.endsWith(".ps1")) {
    return "powershell";
  }

  return "";
}

// Format run summary fields for the dashboard history list using backend
function formatRunLabel(value) {
  return String(value || "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

//format one history timestamp in the viewer's local timezone.
function formatRunTimestamp(run) {
  //use finished, started, and created timestamps in lifecycle order.
  const label = run.finishedUtc
    ? "Finished"
    : run.startedUtc
    ? "Started"
    : "Created";
  const value = run.finishedUtc || run.startedUtc || run.createdUtc;

  //show one clear fallback for missing or malformed values.
  if (!value) {
    return "Timestamp unavailable";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Timestamp unavailable";
  }

  //include the viewer's local timezone with the formatted date and time.
  const formattedTimestamp = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsedDate);

  return `${label}: ${formattedTimestamp}`;
}

//recognizes only inactive terminal summaries that can be submitted for server-side deletion
function canDeleteRun(run) {
  //hide the action for uncertain states because the server must preserve them even if a stale list renders
  return !run.active && ["completed", "failed", "cancelled"].includes(String(run.status || "").toLowerCase());
}

const Dashboard = () => {
  const navigate = useNavigate();

  const configFileInputRef = useRef(null);
  const runnerFileInputRef = useRef(null);
  const deleteConfirmationInputRef = useRef(null);

  const [testName, setTestName] = useState("");
  // Runner name is display metadata; runner content is the source the backend
  // will persist into the isolated run folder before the guest agent executes it.
  const [runnerScriptName, setRunnerScriptName] = useState("");
  const [runnerScriptContent, setRunnerScriptContent] = useState("");
  const [runnerScriptLanguage, setRunnerScriptLanguage] = useState("");
  const [configFileName, setConfigFileName] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [user, setUser] = useState(null);
  const [isPreparingRun, setIsPreparingRun] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [executionMode, setExecutionMode] = useState("custom")
  const [runPendingDeletion, setRunPendingDeletion] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeletingRun, setIsDeletingRun] = useState(false);

  // Explicit loading/error flags so the history card can render all three
  // required states: loading, empty, and request-failure.
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState("");

  const [readiness, setReadiness] = useState({
    docker: false,
    backend: false,
    storage: true,
    // The VM status is informative rather than blocking. The backend can start
    // the guest on demand, but surfacing its state makes debugging much easier.
    windowsVmStatus: "unknown",
    windowsVmMessage: "",
    checking: true,
    lastChecked: null,
  });

  useEffect(() => {
    const storedRun = readStoredRun();

    if (storedRun?.testName) {
      setTestName(storedRun.testName);
    }

    if (storedRun?.runnerScriptName) {
      setRunnerScriptName(storedRun.runnerScriptName);
    }

    // Rehydrate the uploaded runner source so returning from Confirmation does
    // not reduce the run setup back to filename-only state.
    if (storedRun?.runnerScriptContent) {
      setRunnerScriptContent(storedRun.runnerScriptContent);
    }

    if (storedRun?.runnerScriptLanguage) {
      setRunnerScriptLanguage(storedRun.runnerScriptLanguage);
    }

    if (storedRun?.configFileName) {
      setConfigFileName(storedRun.configFileName);
    }

    if (storedRun?.executionMode) {
      setExecutionMode(storedRun.executionMode);
    }

    fetchCurrentUser();
    loadRuns();
    checkReadiness();

    const interval = setInterval(checkReadiness, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    //focus the required confirmation field when the dialog opens for keyboard users
    if (runPendingDeletion) deleteConfirmationInputRef.current?.focus();
  }, [runPendingDeletion]);

  async function fetchCurrentUser() {
    try {
      /**
       * If auth is available and the user is signed in, use that.
       * If not, redirect the user to the landing page.
       */
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      //prevents users from bypassing sign in when adding "/dashboard" in the address bar
      if (!response.ok) {
        navigate("/", { replace: true });
      }

      const data = await response.json();
      setUser(data.user || data);
    } catch {
      navigate("/", { replace: true });
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function loadRuns() {
    setRunsLoading(true);
    setRunsError("");

    try {
      const response = await fetch("/api/runs", { credentials: "include" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Failed to load recent runs.");
      }

      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (error) {
      setRuns([]);
      setRunsError(error.message || "Failed to load recent runs.");
    } finally {
      setRunsLoading(false);
    }
  }

  //opens a local confirmation dialog without changing history or requesting deletion
  function handleDeleteRun(run) {
    //reset only temporary dialog state so dismissal cannot affect any history entry
    setRunPendingDeletion(run);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  //closes the confirmation dialog without making a deletion request
  function dismissDeleteRun() {
    //retain all history data because cancellation is only a local UI action
    if (isDeletingRun) return;
    setRunPendingDeletion(null);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  //submits one exact-confirmation deletion and refreshes history only after the server responds
  async function confirmDeleteRun(event) {
    event.preventDefault();
    //reject every near match locally so invalid input cannot make an api request
    if (!runPendingDeletion || deleteConfirmation !== "CONFIRM" || isDeletingRun) return;

    setIsDeletingRun(true);
    setDeleteError("");
    try {
      const result = await deleteRun(runPendingDeletion.runId, deleteConfirmation);
      //refresh rather than removing optimistically so automatic cleanup races cannot remove another item
      await loadRuns();
      setRunPendingDeletion(null);
      setDeleteConfirmation("");
      pushNotification(
        "warn",
        "Run history deleted",
        result.alreadyDeleted
          ? "The run had already been removed from server history."
          : "The selected run history and server-side artifacts were deleted."
      );
    } catch (error) {
      if (error.status === 404) {
        //treat not found as concurrent automatic cleanup and refresh without deleting another entry
        await loadRuns();
        setRunPendingDeletion(null);
        setDeleteConfirmation("");
        pushNotification("warn", "Run history refreshed", "The selected run was already removed from server history.");
      } else {
        //keep the selected entry and input available so genuine server failures can be corrected or retried
        setDeleteError(error.message || "Failed to delete run history.");
      }
    } finally {
      setIsDeletingRun(false);
    }
  }

  function handleOpenRun(run) {
    navigate("/running-test", {
      state: {
        runId: run.runId,
        testName: run.testName,
      },
    });
  }

  async function checkReadiness() {
    try {
      // Poll each subsystem independently so the UI can explain whether the
      // problem is backend availability, Docker reachability, disk space, or
      // the Windows guest itself.
      const [healthRes, dockerRes, storageRes, windowsVmRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/docker/ping"),
        fetch("/api/storage/space"),
        fetch("/api/windows-vm/status"),
      ]);

      let backendStatus = false;
      let dockerStatus = false;
      let storageStatus = true;
      let windowsVmStatus = "unknown";
      let windowsVmMessage = "";

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        backendStatus = Boolean(healthData.success);
      }

      if (dockerRes.ok) {
        const dockerData = await dockerRes.json();
        dockerStatus = Boolean(dockerData.success);
      }

      if (storageRes.ok) {
        const storageData = await storageRes.json();
        storageStatus = Boolean(storageData.success);
      }

      if (windowsVmRes.ok) {
        const windowsVmData = await windowsVmRes.json();
        windowsVmStatus = windowsVmData.windowsVm?.status || "unknown";
        windowsVmMessage = windowsVmData.windowsVm?.message || "";
      }

      setReadiness({
        docker: dockerStatus,
        backend: backendStatus,
        storage: storageStatus,
        windowsVmStatus,
        windowsVmMessage,
        checking: false,
        lastChecked: new Date().toLocaleTimeString(),
      });
    } catch {
      setReadiness({
        docker: false,
        backend: false,
        storage: true,
        windowsVmStatus: "unknown",
        windowsVmMessage: "",
        checking: false,
        lastChecked: new Date().toLocaleTimeString(),
      });
    }
  }

  function pushNotification(type, title, msg) {
    const id = crypto.randomUUID();
    setNotifications((current) => [...current, { id, type, title, msg }]);
  }

  function dismissNotification(id) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  function resetRunForm(showNotification = true) {
    setTestName("");
    // Clear runner fields together; a script name without source content should
    // never be treated as runnable.
    setRunnerScriptName("");
    setRunnerScriptContent("");
    setRunnerScriptLanguage("");
    setConfigFileName("");
    setIsPreparingRun(false);
    clearStoredRun();

    if (configFileInputRef.current) {
      configFileInputRef.current.value = "";
    }

    if (runnerFileInputRef.current) {
      runnerFileInputRef.current.value = "";
    }

    if (showNotification) {
      pushNotification(
        "warn",
        "Form reset",
        "The current test run setup has been cleared."
      );
    }
  }

  function handleTestNameChange(event) {
    const nextValue = event.target.value;
    setTestName(nextValue);
    writeStoredRun({ testName: nextValue });
  }

  function handleConfigUploadClick() {
    configFileInputRef.current?.click();
  }

  function handleRunnerUploadClick() {
    runnerFileInputRef.current?.click();
  }

  // Read the selected .ps1 into memory. This replaces the old filename-only
  // upload path and creates the payload Confirmation sends to the backend.
  function handleRunnerFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isValidRunner = ALLOWED_RUNNER_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    );

    if (!isValidRunner) {
      setRunnerScriptName("");
      setRunnerScriptContent("");
      setRunnerScriptLanguage("");
      writeStoredRun({
        runnerScriptName: "",
        runnerScriptContent: "",
        runnerScriptLanguage: "",
      });

      pushNotification(
        "error",
        "Invalid runner script",
        "Please upload a .py or .ps1 runner script for this prototype."
      );

      event.target.value = "";
      return;
    }

    // Keep the browser/sessionStorage payload bounded until backend upload
    // limits are formalized as part of the script_run contract.
    if (file.size > MAX_RUNNER_SCRIPT_SIZE_BYTES) {
      setRunnerScriptName("");
      setRunnerScriptContent("");
      setRunnerScriptLanguage("");
      writeStoredRun({
        runnerScriptName: "",
        runnerScriptContent: "",
        runnerScriptLanguage: "",
      });

      pushNotification(
        "error",
        "Runner script too large",
        "Please upload a .py or .ps1 runner script smaller than 256 KB."
      );

      event.target.value = "";
      return;
    }

    // FileReader lets this prototype move the selected script through the
    // existing page flow without adding a separate upload endpoint yet.
    const reader = new FileReader();

    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      const language = getRunnerScriptLanguage(file.name);

      setRunnerScriptName(file.name);
      setRunnerScriptContent(content);
      setRunnerScriptLanguage(language);
      writeStoredRun({
        testName,
        runnerScriptName: file.name,
        runnerScriptContent: content,
        runnerScriptLanguage: language,
      });

      pushNotification(
        "ready",
        "Runner selected",
        `${file.name} was read and is ready for the next step.`
      );
    };

    reader.onerror = () => {
      setRunnerScriptName("");
      setRunnerScriptContent("");
      setRunnerScriptLanguage("");
      writeStoredRun({
        runnerScriptName: "",
        runnerScriptContent: "",
        runnerScriptLanguage: "",
      });

      pushNotification(
        "error",
        "Unable to read runner",
        "The selected runner script could not be read. Please try again."
      );
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function handleConfigFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isValidConfig = ALLOWED_CONFIG_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    );

    if (!isValidConfig) {
      setConfigFileName("");
      writeStoredRun({ configFileName: "", configContent: "" });

      pushNotification(
        "error",
        "Invalid config file",
        `${file.name} is not a supported task plan. Please upload a .json file.`
      );

      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setConfigFileName(file.name);

      writeStoredRun({
        testName,
        configFileName: file.name,
        configContent: content,
      });

      pushNotification(
        "ready",
        "Task plan selected",
        `${file.name} is ready for the next step.`
      );
    };

    reader.onerror = () => {
      setConfigFileName("");
      writeStoredRun({ configFileName: "", configContent: "" });

      pushNotification(
        "error",
        "Unable to read config",
        "The selected config file could not be read. Please try again."
      );
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  // Start-run validation now requires both the filename and the readable source
  // body because the backend needs actual script content to execute later.
  function handleStartRun() {
    const testNameError = validateTestName(testName);
    let runnerError = ""
      if (executionMode === "custom") {
        if (!runnerScriptName) {
          runnerError = "Runner Script is required.";
        }
        else if (!runnerScriptContent) {
          runnerError = "Runner Script content could not be read.";
        }
      }

    const configError = !configFileName ? "Task Plan JSON required." : "";

    if (testNameError) {
      pushNotification("error", "Invalid test name", testNameError);
      return;
    }

    if (runnerError) {
      pushNotification("error", "Runner script required", runnerError);
      return;
    }

    if (configError) {
      pushNotification("error", "Config file required", configError);
      return;
    }

    if (!isSystemReady) {
      pushNotification(
        "error",
        "System not ready",
        "Resolve readiness issues before starting a run."
      );
      return;
    }

    const storedRun = readStoredRun();
    const configContent = storedRun?.configContent ?? "";

    setIsPreparingRun(true);

    // Persist and pass the same runner source to Confirmation so preview and
    // submit operate on the exact script selected on the Dashboard.
    writeStoredRun({
      testName: testName.trim(),
      runnerScriptName,
      runnerScriptContent,
      runnerScriptLanguage,
      configFileName,
      configContent,
      executionMode
    });

    navigate("/confirmation", {
      state: {
        testName: testName.trim(),
        runnerScriptName,
        runnerScriptContent,
        runnerScriptLanguage,
        configFileName,
        configContent,
        executionMode
      },
    });

    setIsPreparingRun(false);
  }

  // update selected mode and remember the mode even after page refresh
  function handleModeChange(event) {
    const mode = event.target.value;
    setExecutionMode(mode);
    writeStoredRun({ executionMode: mode });
  }

  const testNameError = validateTestName(testName);
  let runnerError = ""
    if (executionMode === "custom") {
      if (!runnerScriptName) {
        runnerError = "Runner Script is required.";
      }
      else if (!runnerScriptContent) {
        runnerError = "Runner Script content could not be read.";
      }
  }
  const configError = !configFileName ? "Task Plan JSON required." : "";
  // Keep the launch gate focused on host prerequisites. The backend is allowed
  // to cold-start the Windows guest during run creation if it is not up yet.
  const isSystemReady =
    readiness.docker && readiness.backend && readiness.storage;
  const isWindowsVmRunning = readiness.windowsVmStatus === "running";

  const displayName = user?.name || user?.fname || "";

  if (isAuthLoading) {
    return (
      <>
        <Navigation />
        <main className="Auth-Check">
          <p>Checking your session...</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />

      <div className="dash-hero">
        <h1 className="dash-welcome">
          Welcome <span>{displayName}</span>
        </h1>
        <p className="dash-email">{user?.email || ""}</p>
      </div>

      <div className="Dashboard-wrapper">
        <main className="Dashboard-page">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Create New Test Run</div>
            </div>

            <div className="card-body">
              <label className="form-label">Insert Test Run Name</label>
              <input
                className="form-input"
                value={testName}
                onChange={handleTestNameChange}
                placeholder="Name #1"
              />
              {testNameError && <p className="error-text">{testNameError}</p>}

              <div className="runner-modes">
                <label>
                  <input type="radio"
                        name="mode"
                        value="custom"
                        checked={executionMode === "custom"}
                        onChange={handleModeChange}
                        /> Custom Runner
                </label>
                
                <label>
                  <input type="radio"
                        name="mode"
                        value="builtin"
                        checked={executionMode === "builtin"}
                        onChange={handleModeChange}
                        /> Built-In Notepad
                </label>
              </div>

              <div className="form-stack">
                {/* checks the what mode is selected and displays which container based on the mode */}
                {executionMode === "custom" && (
                  <div className="runner-upload">
                    <button
                      className="btn"
                      type="button"
                      onClick={handleRunnerUploadClick}
                    >
                      <UploadIcon />{" "}
                      {runnerScriptName
                        ? `Replace Runner Script (${runnerScriptName})`
                        : "Upload Runner Script (.py or .ps1)"}
                    </button>

                    <input
                      ref={runnerFileInputRef}
                      type="file"
                      accept=".py,.ps1"
                      onChange={handleRunnerFileSelected}
                      style={{ display: "none" }}
                    />

                    {runnerScriptName && (
                      <p className="file-name">Selected: {runnerScriptName}</p>
                    )}
                    {runnerError && <p className="error-text">{runnerError}</p>}
                  </div>
                )}
                <button
                  className="btn"
                  type="button"
                  onClick={handleConfigUploadClick}
                >
                  <UploadIcon />{" "}
                  {configFileName
                    ? `Replace Task Plan (${configFileName})`
                    : "Upload Task Plan (.json)"}
                </button>

                <input
                  ref={configFileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleConfigFileSelected}
                  style={{ display: "none" }}
                />

                {configFileName && (
                  <p className="file-name">Selected: {configFileName}</p>
                )}
                {configError && <p className="error-text">{configError}</p>}

                <button
                  className="btn"
                  type="button"
                  onClick={() => navigate("/configuration-settings")}
                >
                  <SettingsIcon /> Configure Settings
                </button>

                <button
                  className="btn"
                  type="button"
                  onClick={() => resetRunForm(true)}
                >
                  Clear Current Run
                </button>
              </div>

              <button
                className="btn btn-primary"
                type="button"
                onClick={handleStartRun}
                disabled={!isSystemReady || isPreparingRun}
                style={{
                  opacity: !isSystemReady || isPreparingRun ? 0.5 : 1,
                  cursor:
                    !isSystemReady || isPreparingRun
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                <RunIcon /> {isPreparingRun ? "Preparing..." : "Start Test Run"}
              </button>

              <p className="nav-to-generate-page">Don't have a json file and would like to generate one? Generate one <a href="/create-a-task">here</a>.</p>
            </div>

            {!readiness.checking && !isSystemReady && (
              <div className="readiness-alert">
                <strong>Start Run Disabled: </strong>
                {!readiness.backend && "Backend is offline. "}
                {readiness.backend &&
                  !readiness.docker &&
                  "Docker Desktop is not running. "}
                {readiness.backend &&
                  readiness.docker &&
                  !readiness.storage &&
                  "Insufficient storage space for VM."}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Launcher readiness</div>
            </div>

            <div className="card-body">
              <div className="status-row status-header">
                <div className="status-label">Readiness check</div>
                <div className="status-value">
                  {readiness.lastChecked
                    ? `Updated ${readiness.lastChecked}`
                    : readiness.checking
                    ? "Checking..."
                    : "Not checked yet"}
                </div>
              </div>

              <div className="status-row">
                <div className="status-label">Backend availability</div>
                <div
                  className={`status-badge ${
                    readiness.backend ? "ready" : "unready"
                  }`}
                >
                  {readiness.checking
                    ? "…"
                    : readiness.backend
                    ? "Ready"
                    : "Unavailable"}
                </div>
              </div>

              <div className="status-row">
                <div className="status-label">Docker availability</div>
                <div
                  className={`status-badge ${
                    readiness.docker ? "ready" : "unready"
                  }`}
                >
                  {readiness.checking
                    ? "…"
                    : readiness.docker
                    ? "Ready"
                    : "Unavailable"}
                </div>
              </div>

              <div className="status-row">
                <div className="status-label">Windows guest</div>
                <div
                  className={`status-badge ${
                    isWindowsVmRunning ? "ready" : "unready"
                  }`}
                  title={readiness.windowsVmMessage || readiness.windowsVmStatus}
                >
                  {readiness.checking
                    ? "â€¦"
                    : readiness.windowsVmStatus === "not-created"
                    ? "Not started"
                    : readiness.windowsVmStatus === "docker-error"
                    ? "Docker error"
                    : isWindowsVmRunning
                    ? "Running"
                    : readiness.windowsVmStatus || "Unknown"}
                </div>
              </div>

              <div className="status-row">
                <div className="status-label">Required launch readiness</div>
                <div
                  className={`status-badge ${
                    isSystemReady ? "ready" : "unready"
                  }`}
                >
                  {readiness.checking
                    ? "…"
                    : isSystemReady
                    ? "Ready"
                    : "Not ready"}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header card-header--actions">
              <div className="card-title">Recent Test Runs</div>
              <button
                className="run-refresh"
                type="button"
                onClick={loadRuns}
                disabled={runsLoading}
              >
                {runsLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {runsLoading && runs.length === 0 ? (
              <div className="run-list-state">Loading recent runs...</div>
            ) : runsError ? (
              <div className="run-list-state run-list-state--error">
                <p>{runsError}</p>
                <button className="run-retry" type="button" onClick={loadRuns}>
                  Retry
                </button>
              </div>
            ) : runs.length > 0 ? (
              <ul className="run-list">
                {runs.map((run) => (
                  <li key={run.runId} className="run-item">
                    <div className="run-item-left">
                      <div
                        className={`run-dot run-dot--${String(
                          run.status || "unknown"
                        ).toLowerCase()}`}
                      />
                      <div>
                        <div className="run-name">{run.testName}</div>
                        <div className="run-meta">
                          <span className="run-mode">
                            {formatRunLabel(run.taskType) || "Unknown"}
                          </span>
                          <span className="run-mode">
                            {run.totalIterations ?? 1} iteration
                            {(run.totalIterations ?? 1) === 1 ? "" : "s"}
                          </span>
                          <span
                            className={`run-status run-status--${String(
                              run.status || "unknown"
                            ).toLowerCase()}`}
                          >
                            {formatRunLabel(run.status) || "Unknown"}
                          </span>
                          {run.active && (
                            <span className="run-active">Active</span>
                          )}
                        </div>
                        <div className="run-date">{formatRunTimestamp(run)}</div>
                      </div>
                    </div>
                    <div className="run-actions">
                      {canDeleteRun(run) && (
                        <button
                          className="run-delete"
                          type="button"
                          onClick={() => handleDeleteRun(run)}
                        >
                          Delete
                        </button>
                      )}
                      <button
                        className="run-open"
                        type="button"
                        onClick={() => handleOpenRun(run)}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <EmptyIcon />
                </div>
                <div className="empty-title">No recent Test Runs</div>
                <div className="empty-sub">
                  It&apos;s empty in here&hellip;
                  <br />
                  Start a new test run to see it appear.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {runPendingDeletion && (
        <div className="run-delete-dialog-backdrop" role="presentation">
          <form
            className="run-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-delete-dialog-title"
            onSubmit={confirmDeleteRun}
          >
            <h2 id="run-delete-dialog-title">Delete run history</h2>
            <p>
              Delete <strong>{runPendingDeletion.testName || runPendingDeletion.runId}</strong>
              {` (${runPendingDeletion.runId})`} with status {formatRunLabel(runPendingDeletion.status) || "Unknown"}.
            </p>
            <p>{formatRunTimestamp(runPendingDeletion)}</p>
            <p>Server-side history and artifacts will be deleted. Downloaded and exported copies on your device will remain untouched.</p>
            <label className="form-label" htmlFor="run-delete-confirmation">
              Type CONFIRM to delete this run
            </label>
            <input
              ref={deleteConfirmationInputRef}
              id="run-delete-confirmation"
              className="form-input"
              type="text"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              disabled={isDeletingRun}
              autoComplete="off"
            />
            {deleteError && <p className="error-text" role="alert">{deleteError}</p>}
            <div className="run-delete-dialog-actions">
              <button className="run-open" type="button" onClick={dismissDeleteRun} disabled={isDeletingRun}>
                Cancel
              </button>
              <button
                className="run-delete"
                type="submit"
                disabled={deleteConfirmation !== "CONFIRM" || isDeletingRun}
              >
                {isDeletingRun ? "Deleting..." : "Delete run"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="Notify-stack">
        {notifications.map((item) => (
          <div key={item.id} className="Notify">
            <div className={`Notify-icon ${item.type}`}>
              {item.type === "error" ? "✕" : "!"}
            </div>
            <div className="Notify-content">
              <div className="Notify-title">{item.title}</div>
              <div className="Notify-msg">{item.msg}</div>
            </div>
            <button
              className="Notify-close"
              onClick={() => dismissNotification(item.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
};

export default Dashboard;

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

/**
 * The dashboard owns two pieces of transient user state:
 * - the in-progress run configuration persisted in sessionStorage
 * - launcher readiness signals polled from the backend
 *
 * Keeping both here lets the flow survive refreshes without pushing partially
 * complete run setup into a more global store.
 */

const RECENT_RUNS = [
  { id: "a", name: "Test Run A", date: "xx/xx/xxxx" },
  { id: "b", name: "Test Run B", date: "xx/xx/xxxx" },
  { id: "c", name: "Test Run C", date: "xx/xx/xxxx" },
  { id: "d", name: "Test Run D", date: "xx/xx/xxxx" },
  { id: "e", name: "Test Run E", date: "xx/xx/xxxx" },
];

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

const Dashboard = () => {
  const navigate = useNavigate();

  const configFileInputRef = useRef(null);
  const runnerFileInputRef = useRef(null);

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

    fetchCurrentUser();
    checkReadiness();

    const interval = setInterval(checkReadiness, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchCurrentUser() {
    try {
      /**
       * If auth is available and the user is signed in, use that.
       * If not, fall back to demo data so the Dashboard still works during development.
       */
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (!response.ok) {
        setUser({
          name: "Leo",
          email: "leo@leomail.com",
        });
        return;
      }

      const data = await response.json();
      setUser(data.user || data);
    } catch {
      setUser({
        name: "Leo",
        email: "leo@leomail.com",
      });
    }
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
    const runnerError = !runnerScriptName
      ? "Runner Script is required."
      : !runnerScriptContent
      ? "Runner Script content could not be read."
      : "";
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
    });

    navigate("/confirmation", {
      state: {
        testName: testName.trim(),
        runnerScriptName,
        runnerScriptContent,
        runnerScriptLanguage,
        configFileName,
        configContent,
      },
    });

    setIsPreparingRun(false);
  }

  const testNameError = validateTestName(testName);
  // Mirror handleStartRun validation so inline errors match the launch gate.
  const runnerError = !runnerScriptName
    ? "Runner Script is required."
    : !runnerScriptContent
    ? "Runner Script content could not be read."
    : "";
  const configError = !configFileName ? "Task Plan JSON required." : "";
  // Keep the launch gate focused on host prerequisites. The backend is allowed
  // to cold-start the Windows guest during run creation if it is not up yet.
  const isSystemReady =
    readiness.docker && readiness.backend && readiness.storage;
  const isWindowsVmRunning = readiness.windowsVmStatus === "running";

  const displayName = user?.name || user?.fname || "User";

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

              <div className="form-stack">
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
            <div className="card-header">
              <div className="card-title">Recent Test Runs</div>
            </div>

            {RECENT_RUNS.length > 0 ? (
              <ul className="run-list">
                {RECENT_RUNS.map((run) => (
                  <li key={run.id} className="run-item">
                    <div className="run-item-left">
                      <div className="run-dot" />
                      <div>
                        <div className="run-name">{run.name}</div>
                        <div className="run-date">Last edit: {run.date}</div>
                      </div>
                    </div>
                    <button className="run-open" type="button">
                      Open
                    </button>
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
                  It&apos;s empty in here…
                  <br />
                  Start a new test run to see it appear.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

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

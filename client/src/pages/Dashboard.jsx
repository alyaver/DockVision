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
 * Dashboard cleanup notes:
 * - Remove all merge-conflict markers and duplicate branches.
 * - Keep the readiness-check flow from the spike-style branch.
 * - Keep the improved upload flow and sessionStorage persistence.
 * - Do NOT keep the duplicate validation-only branch that conflicted with it.
 */

const RECENT_RUNS = [
  { id: "a", name: "Test Run A", date: "xx/xx/xxxx" },
  { id: "b", name: "Test Run B", date: "xx/xx/xxxx" },
  { id: "c", name: "Test Run C", date: "xx/xx/xxxx" },
  { id: "d", name: "Test Run D", date: "xx/xx/xxxx" },
  { id: "e", name: "Test Run E", date: "xx/xx/xxxx" },
];

const ALLOWED_CONFIG_EXTENSIONS = [".json", ".yml", ".yaml"];
const ALLOWED_RUNNER_EXTENSIONS = [".py", ".ps1"];
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

const Dashboard = () => {
  const navigate = useNavigate();

  const configFileInputRef = useRef(null);
  const runnerFileInputRef = useRef(null);

  const [testName, setTestName] = useState("");
  const [runnerScriptName, setRunnerScriptName] = useState("");
  const [configFileName, setConfigFileName] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [user, setUser] = useState(null);
  const [isPreparingRun, setIsPreparingRun] = useState(false);

  const [readiness, setReadiness] = useState({
    docker: false,
    backend: false,
    storage: true,
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
      const [healthRes, dockerRes, storageRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/docker/ping"),
        fetch("/api/storage/space"),
      ]);

      let backendStatus = false;
      let dockerStatus = false;
      let storageStatus = true;

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

      setReadiness({
        docker: dockerStatus,
        backend: backendStatus,
        storage: storageStatus,
        checking: false,
        lastChecked: new Date().toLocaleTimeString(),
      });
    } catch {
      setReadiness({
        docker: false,
        backend: false,
        storage: true,
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
    setRunnerScriptName("");
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

  function handleRunnerFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isValidRunner = ALLOWED_RUNNER_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    );

    if (!isValidRunner) {
      setRunnerScriptName("");
      writeStoredRun({ runnerScriptName: "" });

      pushNotification(
        "error",
        "Invalid runner script",
        "Please upload a .py or .ps1 runner script."
      );

      event.target.value = "";
      return;
    }

    setRunnerScriptName(file.name);
    writeStoredRun({ runnerScriptName: file.name });

    pushNotification(
      "ready",
      "Runner selected",
      `${file.name} is ready for the next step.`
    );

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
        `${file.name} is not a supported config file. Please upload .json, .yml, or .yaml.`
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
        "Config selected",
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

  function handleStartRun() {
    const testNameError = validateTestName(testName);
    const runnerError = !runnerScriptName
      ? "Runner Script is required."
      : "";
    const configError = !configFileName ? "Config File required." : "";

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

    writeStoredRun({
      testName: testName.trim(),
      runnerScriptName,
      configFileName,
      configContent,
    });

    navigate("/confirmation", {
      state: {
        testName: testName.trim(),
        runnerScriptName,
        configFileName,
        configContent,
      },
    });

    setIsPreparingRun(false);
  }

  const testNameError = validateTestName(testName);
  const runnerError = !runnerScriptName ? "Runner Script is required." : "";
  const configError = !configFileName ? "Config File required." : "";
  const isSystemReady =
    readiness.docker && readiness.backend && readiness.storage;

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
                    ? `Replace Config (${configFileName})`
                    : "Upload Config"}
                </button>

                <input
                  ref={configFileInputRef}
                  type="file"
                  accept=".json,.yml,.yaml"
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
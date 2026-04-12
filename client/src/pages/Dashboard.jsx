import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import '../NavBar.css';
import { useState, useEffect, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

// fillers for test
const RECENT_RUNS = [
  { id: "a", name: "Test Run A", date: "xx/xx/xxxx" },
  { id: "b", name: "Test Run B", date: "xx/xx/xxxx" },
  { id: "c", name: "Test Run C", date: "xx/xx/xxxx" },
  { id: "d", name: "Test Run D", date: "xx/xx/xxxx" },
  { id: "e", name: "Test Run E", date: "xx/xx/xxxx" },
];

const ALLOWED_CONFIG_EXTENSIONS = ['.json', '.yml', '.yaml'];
const CURRENT_RUN_STORAGE_KEY = 'dockvision-current-run';

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

const Dashboard = () => {
  const navigate = useNavigate();
  const configFileInputRef = useRef(null);
  const [testName, setTestName] = useState("");
  const [configFile, setConfigFile] = useState(null);
  const [runnerFile, setRunnerFile] = useState(null);
  const [Notify, setNotify] = useState([]);
<<<<<<< HEAD
  const [user, setUser] = useState(null); // store authenticated user's
  const [runnerScript, setRunnerScript] = useState(null); 
  const [configFile, setConfigFile] = useState(null); // store uploaded config file
  
  const [errors, setErrors] = useState({
    testName: "",
    runnerScript: "",
    configFile: "",
  });

  const dismissNotify = (id) => setNotify((n) => n.filter((x) => x.id !== id));

  useEffect(() => {
     // dummy data
        setUser({
          fname: "Leo",
          email:"Leo@leomail.com",
        })
  }, [])

/* need db
  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch("http://localhost:5000/api/auth/me", {
          credentials: "include"
        });

        if (!response.ok) {
          navigate("/sign-in")
          return;
        }
=
        const data = await response.json();

        //setUser(data.user);
        setUser(data.user || data);
        
      }
  
      catch (err) {
        // navigate("/sign-in") need db first
      }
    }

    fetchUser();
  }, [navigate])
*/


=======
  const [isPreparingRun, setIsPreparingRun] = useState(false);
  const [readiness, setRediness] = useState({
    docker: false,
    backend: false,
    storage: true, // assume storage is ready for demo purposes
    checking: true, // flag to indicate if we're still checking readiness status
    lastChecked: null // timestamp of last check
  });

  useEffect(() => {
    const storedRun = readStoredRun();
    if (storedRun?.testName) {
      setTestName(storedRun.testName);
    }
    checkReadiness();
    const interval = setInterval(checkReadiness, 5000); // check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const dismissNotify = (id) => setNotify((n) => n.filter((x) => x.id !== id));
>>>>>>> origin/main
  function pushNotify(type, title, msg) {
    const id = crypto.randomUUID();
    setNotify((n) => [...n, { id, type, title, msg }]);
  }

<<<<<<< HEAD
  /*
  function handleStartRun() {
    if (!testName.trim()) {
=======
  function resetRunForm(showNotification = true) {
    setTestName("");
    setConfigFile(null);
    setRunnerFile(null);
    setIsPreparingRun(false);
    clearStoredRun();
    if (configFileInputRef.current) {
      configFileInputRef.current.value = '';
    }
    if (showNotification) {
      pushNotify(
        'warn',
        'Form reset',
        'The current test run setup has been cleared.'
      );
    }
  }

  function handleConfigUploadClick() {
    configFileInputRef.current?.click();
  }

  function handleConfigFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isValidConfigFile = ALLOWED_CONFIG_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!isValidConfigFile) {
      setConfigFile(null);
      clearStoredRun();
      writeStoredRun({ testName });
      pushNotify(
        'error',
        'Invalid config file',
        `${file.name} is not a supported file type. Please upload a .json, .yml, or .yaml file.`
      );
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setConfigFile(file);
      writeStoredRun({
        testName,
        configFileName: file.name,
        configContent: content,
      });
      pushNotify(
        'ready',
        'Config selected',
        `${file.name} is ready for the next step.`
      );
    };
    reader.onerror = () => {
      setConfigFile(null);
      pushNotify(
        'error',
        'Unable to read config',
        'The selected config file could not be read. Please try again.'
      );
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function handleTestNameChange(event) {
    const nextTestName = event.target.value;
    setTestName(nextTestName);
    writeStoredRun({ testName: nextTestName });
  }

  // Runner script upload logic from feature branch
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".py") && !fileName.endsWith(".ps1")) {
>>>>>>> origin/main
      pushNotify(
        "error",
        "Invalid Runner Script File type",
        "Please upload a valid runner script (.py or .ps1)."
      );
      setRunnerFile(null);
    } else {
      setRunnerFile(file);
    }
    e.target.value = null;
  };
  const removeRunnerFile = () => {
    setRunnerFile(null);
  };

  // Readiness check logic from feature branch
  const checkReadiness = async () => {
    try {
      const healthRes = await fetch("http://localhost:5000/api/health");
      const healthData = await healthRes.json();
      const dockerRes = await fetch("http://localhost:5000/api/docker/ping");
      const storageRes = await fetch("http://localhost:5000/api/storage/space");
      const storageData = await storageRes.json();
      let dockerStatus = false;
      if (dockerRes.ok) {
        const dockerData = await dockerRes.json();
        dockerStatus = dockerData.success;
      }
      setRediness({
        docker: dockerStatus,
        backend: healthData.success,
        storage: storageData.success,
        checking: false,
        lastChecked: new Date().toLocaleTimeString()
      });
    } catch (err) {
      setRediness({
        docker: false,
        backend: false,
        storage: true,
        checking: false,
        lastChecked: new Date().toLocaleTimeString()
      });
    }
  };

  const isSystemReady = readiness.docker && readiness.backend && readiness.storage;

  function handleStartRun() {
    const storedRun = readStoredRun();
    const configFileName = storedRun?.configFileName ?? configFile?.name ?? '';
    const configContent = storedRun?.configContent ?? '';
    if (!testName.trim()) {
      pushNotify(
        'error',
        'Test name required',
        'Please enter a test run name before continuing.'
      );
      return;
    }
    if (!runnerFile) {
      pushNotify(
        'error',
        'Runner script required',
        'Please upload a runner script before continuing.'
      );
      return;
    }
    if (!configFileName || !configContent.trim()) {
      pushNotify(
        'error',
        'Config file required',
        'Please upload a valid config file before continuing.'
      );
      return;
    }
    setIsPreparingRun(true);
    writeStoredRun({
      testName: testName.trim(),
      configFileName,
      configContent,
    });
    navigate('/confirmation', {
      state: {
        testName: testName.trim(),
        configFileName,
        configContent,
      },
    });
    setIsPreparingRun(false);

    /*
    // Re-enable this when the backend route exists:
    async function prepareRun() {
      const formData = new FormData();
      formData.append("testName", testName);
      formData.append("config", configFile);

      const response = await fetch("/api/test-runs/prepare", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to prepare test run");
      }

      const data = await response.json();

      navigate("/confirmation", {
        state: {
          runId: data.runId,
          testName: data.testName ?? testName,
          configFileName: data.configFileName ?? configFile.name,
          configContent: data.configContent ?? "",
        },
      });
    }
    */
  }
    */

  // validate test name input
  function validateTestName(val) {

    // can't be empty
    if (!val.trim()) {
      return "Test name required.";
    }

    // max 50 chars
    if(val.length > 50) {
      return "Test name must be 50 characters or less.";
    }

    // alphanumeric only
    if(!/^[a-zA-Z0-9 ]+$/.test(val)) {
      return "Letters and digits only"
    }

    return ""
  }

  // validates uploaded runner script
  function validateRunnerScript(file) {
    if (!file) {
      return "Runner Script is required.";
    }

    return ""
  }

  // validates uploaded config file
  function validateConfigFile(file) {
    if (!file) {
      return "Config File required.";
    }

    return ""
  }

  // rerun validations when test name or uploaded files change
  useEffect(() => {
    setErrors({
      testName: validateTestName(testName),
      runnerScript: validateRunnerScript(runnerScript),
      configFile: validateConfigFile(configFile),
    })
  }, [testName, runnerScript, configFile])

  const isValid = !errors.testName && !errors.runnerScript && !errors.configFile;

  function handleStartRun() {
    const newErrors = {
      testName: validateTestName(testName),
      runnerScript: validateRunnerScript(runnerScript),
      configFile: validateConfigFile(configFile),
    }

    setErrors(newErrors) // update error message

    // stop if there are errors
    if (newErrors.testName || newErrors.runnerScript || newErrors.configFile) {
      return;
    }

    // go to confirmation page
    navigate("/confirmation", {
      state: {
        testName,
        runnerScriptName: runnerScript ? runnerScript.name : "",
        configFileName: configFile ? configFile.name : "",
      },
    })
  }


  

  return (
    <>
      <Navigation />
      <div className="dash-hero">
        <h1 className="dash-welcome">
          Welcome <span>{user ? user.fname : "User"}</span>
        </h1>
        <p className="dash-email">{user ? user.email : ""}</p>
      </div>
      <div className="Dashboard-wrapper">
        <main className="Dashboard-page">
          {/* Create New Test Run */}
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
              {errors.testName && (
                <p className="error-text">{errors.testName}</p>
              )}

              <div className="form-stack">
<<<<<<< HEAD
                {/*
                <button className="btn" type="button"><UploadIcon /> Upload Runner Script</button>
                <button className="btn" type="button"><UploadIcon /> Upload Config</button>
                */}

                <label className="btn">
                  <UploadIcon /> Upload Runner Script
                  <input type="file" hidden onChange={(e) => setRunnerScript(e.target.files[0])}/>
                </label>

                {runnerScript && (
                  <p className="file-name">Selected: {runnerScript.name}</p>
                )}
                
                {errors.runnerScript && (
                  <p className="error-text">{errors.runnerScript}</p>
                )}

                <label className="btn">
                  <UploadIcon /> Upload Config
                  <input type="file" hidden onChange={(e) => setConfigFile(e.target.files[0])}/>
                </label>

                {configFile && (
                  <p className="file-name">Selected: {configFile.name}</p>
                )}
                
                {errors.configFile && (
                  <p className="error-text">{errors.configFile}</p>
                )}

=======
                {runnerFile ? (
                  <button className="btn" type="button" onClick={removeRunnerFile}>Remove {runnerFile.name} ({`${(runnerFile.size / 1024).toFixed(2)} KB`})</button>
                ) : (
                  <label className="btn">
                    <UploadIcon /> Upload Runner Script (.py or .ps1)
                    <input type="file" accept=".py, .ps1" onChange={handleFileChange} style={{ display: "none" }} />
                  </label>
                )}

                <button className="btn" type="button" onClick={handleConfigUploadClick}><UploadIcon /> Upload Config</button>
                <input
                  ref={configFileInputRef}
                  type="file"
                  accept=".json,.yml,.yaml"
                  onChange={handleConfigFileSelected}
                  style={{ display: 'none' }}
                />
>>>>>>> origin/main
                <button className="btn" type="button" onClick={() => navigate('/configuration-settings')}><SettingsIcon /> Configure Settings</button>
                <button className="btn" type="button" onClick={() => resetRunForm(true)}>
                  Clear Current Run
                </button>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleStartRun} disabled={!isSystemReady} style={{ opacity: !isSystemReady ? 0.5 : 1, cursor: isSystemReady ? "pointer" : "not-allowed" }}><RunIcon /> Start Test Run</button>
            </div>
              {!readiness.checking && !isSystemReady && (
                <div className="readiness-alert">
                  <strong>Start Run Disabled: </strong>
                  {!readiness.backend && "Backend is offline. "}
                  {readiness.backend && !readiness.docker && "Docker Desktop is not running. "}
                  {readiness.backend && readiness.docker && !readiness.storage && "Insufficient storage space for VM."}
                </div>
              )}
          </div>
          {/* Launcher Readiness Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Launcher readiness</div>
            </div>
            <div className="card-body">
              <div className="status-row status-header">
                <div className="status-label">Readiness check</div>
                <div className="status-value">{readiness.lastChecked ? `Updated ${readiness.lastChecked}` : readiness.checking ? "Checking..." : "Not checked yet"}</div>
              </div>
              <div className="status-row">
                <div className="status-label">Backend availability</div>
                <div className={`status-badge ${readiness.backend ? "ready" : "unready"}`}>
                  {readiness.checking ? "…" : readiness.backend ? "Ready" : "Unavailable"}
                </div>
              </div>
              <div className="status-row">
                <div className="status-label">Docker availability</div>
                <div className={`status-badge ${readiness.docker ? "ready" : "unready"}`}>
                  {readiness.checking ? "…" : readiness.docker ? "Ready" : "Unavailable"}
                </div>
              </div>
              <div className="status-row">
                <div className="status-label">Required launch readiness</div>
                <div className={`status-badge ${(readiness.backend && readiness.docker) ? "ready" : "unready"}`}>
                  {readiness.checking ? "…" : (readiness.backend && readiness.docker) ? "Ready" : "Not ready"}
                </div>
              </div>
<<<<<<< HEAD
              <button className="btn btn-primary" type="button" onClick={handleStartRun} disabled={!isValid} ><RunIcon /> Start Test Run</button>
=======
>>>>>>> origin/main
            </div>
          </div>
          {/* Recent Test Runs just display no function —*/}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Recent Test Runs</div>
            </div>
            {RECENT_RUNS.length > 0 ? (
              <ul className="run-list">
                {RECENT_RUNS.map(run => (
                  <li key={run.id} className="run-item">
                    <div className="run-item-left">
                      <div className="run-dot" />
                      <div>
                        <div className="run-name">{run.name}</div>
                        <div className="run-date">Last edit: {run.date}</div>
                      </div>
                    </div>
                    <button className="run-open" type="button">Open</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <EmptyIcon />
                </div>
                <div className="empty-title">No recent Test Runs</div>
                <div className="empty-sub">It's empty in here…<br/>Start a new test run to see it appear.</div>
              </div>
            )}
          </div>
        </main>
      </div>
      {/* Notification Stack */}
      <div className="Notify-stack">
        {Notify.map(t => (
          <div key={t.id} className="Notify">
            <div className={`Notify-icon ${t.type}`}>
              {t.type === "error" ? "✕" : "!"}
            </div>
            <div className="Notify-content">
              <div className="Notify-title">{t.title}</div>
              <div className="Notify-msg">{t.msg}</div>
            </div>
            <button className="Notify-close" onClick={() => dismissNotify(t.id)} type="button">×</button>
          </div>
        ))}
      </div>
    </>
  );
};

export default Dashboard;
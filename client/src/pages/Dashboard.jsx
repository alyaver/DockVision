import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import '../NavBar.css';
import { useEffect, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom';

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
  const [Notify, setNotify] = useState([]);
  const [isPreparingRun, setIsPreparingRun] = useState(false);

  useEffect(() => {
    const storedRun = readStoredRun();

    if (storedRun?.testName) {
      setTestName(storedRun.testName);
    }
  }, []);

  const dismissNotify = (id) => setNotify((n) => n.filter((x) => x.id !== id));

  function pushNotify(type, title, msg) {
    const id = crypto.randomUUID();
    setNotify((n) => [...n, { id, type, title, msg }]);
  }

  function resetRunForm(showNotification = true) {
    setTestName("");
    setConfigFile(null);
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
    const isValidConfigFile = ALLOWED_CONFIG_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    );

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
        'warn',
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

  return (
    <>
      <Navigation />
      <div className="dash-hero">
        <h1 className="dash-welcome">
          Welcome <span>(Username)</span>
        </h1>
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
              <div className="form-stack">
                <button className="btn" type="button"><UploadIcon /> Upload Runner Script</button>
                <button className="btn" type="button" onClick={handleConfigUploadClick}>
                  <UploadIcon /> Upload Config
                </button>
                <input
                  ref={configFileInputRef}
                  type="file"
                  accept=".json,.yml,.yaml"
                  onChange={handleConfigFileSelected}
                  style={{ display: 'none' }}
                />
                <button className="btn" type="button" onClick={() => navigate('/configuration-settings')}><SettingsIcon /> Configure Settings</button>
                <button className="btn" type="button" onClick={() => resetRunForm(true)}>
                  Clear Current Run
                </button>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleStartRun} disabled={isPreparingRun}>
                <RunIcon /> {isPreparingRun ? 'Preparing Test Run...' : 'Start Test Run'}
              </button>
            </div>
          </div>
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
      <div className="Notify-stack">
        {Notify.map(t => (
          <div key={t.id} className="Notify">
            <div className={`Notify-icon ${t.type}`}>
              {t.type === 'error' ? '✕' : '!'}
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

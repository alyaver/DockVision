import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import '../NavBar.css';
import { useEffect, useState } from "react";
import { useNavigate } from 'react-router-dom';
import { getReadiness } from '../lib/api';

// fillers for test
const RECENT_RUNS = [
  { id: "a", name: "Test Run A", date: "xx/xx/xxxx" },
  { id: "b", name: "Test Run B", date: "xx/xx/xxxx" },
  { id: "c", name: "Test Run C", date: "xx/xx/xxxx" },
  { id: "d", name: "Test Run D", date: "xx/xx/xxxx" },
  { id: "e", name: "Test Run E", date: "xx/xx/xxxx" },
];


const Dashboard = () => {
  const navigate = useNavigate();
  const [testName, setTestName] = useState("");
  const [Notify, setNotify] = useState([]);
  //initial readiness state sets all to false until first check is complete
  const [readiness, setReadiness] = useState({
    backendAvailable: false,
    dockerAvailable: false,
    requiredLaunchReady: false,
    loading: true,
    lastChecked: null,
    errorMessage: "",
  });

  const dismissNotify = (id) => setNotify((n) => n.filter((x) => x.id !== id));

  async function refreshReadiness() {
    setReadiness((prev) => ({ ...prev, loading: true, errorMessage: "" }));

    try {
      const result = await getReadiness();
      setReadiness({
          backendAvailable: result.backendAvailable,
          dockerAvailable: result.dockerAvailable,
          requiredLaunchReady: result.requiredLaunchReady,
          loading: false,
          lastChecked: new Date().toLocaleTimeString(),
          errorMessage: "",
        });
    } catch (error) {
      //if the backend is not reachable then set everything to false
        setReadiness({
          backendAvailable: false,
          dockerAvailable: false,
          requiredLaunchReady: false,
          loading: false,
          lastChecked: new Date().toLocaleTimeString(),
          errorMessage: error.message || "Unable to refresh readiness",
      });
    }
  }

  useEffect(() => {
    refreshReadiness();
    //refresh interval is set to every 10 seconds
    const interval = setInterval(refreshReadiness, 10000);
    return () => clearInterval(interval);
  }, []);

  function pushNotify(type, title, msg) {
    const id = crypto.randomUUID();
    setNotify((n) => [...n, { id, type, title, msg }]);
  }

  function handleStartRun() {
    if (!testName.trim()) {
      pushNotify(
        "error",
        "Test name required",
        "Please enter a test run name before continuing."
      );
      return;
    }
    navigate("/confirmation");
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
                onChange={e => setTestName(e.target.value)}
                placeholder="Name #1"
              />
              <div className="form-stack">
                <button className="btn" type="button"><UploadIcon /> Upload Runner Script</button>
                <button className="btn" type="button"><UploadIcon /> Upload Config</button>
                <button className="btn" type="button" onClick={() => navigate('/configuration-settings')}><SettingsIcon /> Configure Settings</button>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleStartRun}><RunIcon /> Start Test Run</button>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Launcher readiness</div>
            </div>
            <div className="card-body">
              <div className="status-row status-header">
                <div className="status-label">Readiness check</div>
                <div className="status-value">{readiness.loading ? "Checking..." : readiness.lastChecked ? `Updated ${readiness.lastChecked}` : "Not checked yet"}</div>
              </div>
              <div className="status-row">
                <div className="status-label">Backend availability</div>
                <div className={`status-badge ${readiness.backendAvailable ? "ready" : "unready"}`}>
                  {readiness.loading ? "…" : readiness.backendAvailable ? "Ready" : "Unavailable"}
                </div>
              </div>
              <div className="status-row">
                <div className="status-label">Docker availability</div>
                <div className={`status-badge ${readiness.dockerAvailable ? "ready" : "unready"}`}>
                  {readiness.loading ? "…" : readiness.dockerAvailable ? "Ready" : "Unavailable"}
                </div>
              </div>
              <div className="status-row">
                <div className="status-label">Launch readiness</div>
                <div className={`status-badge ${
                  readiness.requiredLaunchReady === null ? "unknown" : 
                  readiness.requiredLaunchReady ? "ready" : "unready"
                }`}>
                  {readiness.loading ? "…" : 
                   readiness.requiredLaunchReady === null ? "Unknown" :
                   readiness.requiredLaunchReady ? "Ready" : "Not ready"}
                </div>
              </div>
              {readiness.errorMessage ? (
                <div className="status-note">{readiness.errorMessage}</div>
              ) : null}
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
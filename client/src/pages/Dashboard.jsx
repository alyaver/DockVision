import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import '../NavBar.css';
import { useState } from "react";
import { useNavigate } from 'react-router-dom';

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
  const [runnerFile, setRunnerFile] = useState(null);

  const dismissNotify = (id) => setNotify((n) => n.filter((x) => x.id !== id));

  function pushNotify(type, title, msg) {
    const id = crypto.randomUUID();
    setNotify((n) => [...n, { id, type, title, msg }]);
  }

  const handleFileChange = (e) => { // validate file type and size before accepting
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".py") && !fileName.endsWith(".ps1")) { // only accept .py or .ps1 files
      pushNotify(
        "error",
        "Invalid Runner Script File type",
        "Please upload a valid runner script (.py or .ps1).");
      setRunnerFile(null);
    } else {
      setRunnerFile(file);
    }
    e.target.value = null; // reset file input
  };

  const removeRunnerFile = () => { // remove selected file
    setRunnerFile(null);
  };

  function handleStartRun() {
    if (!testName.trim()) {
      pushNotify(
        "error",
        "Test name required",
        "Please enter a test run name before continuing."
      );
      return;
    }
    
    if(!runnerFile) { // runner script is required to start a test run
      pushNotify(
        "error",
        "Runner script required",
        "Please upload a runner script before continuing."
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
                {runnerFile ? ( // if file is uploaded, show file info and remove option
                  <button className="btn" type="button" onClick={removeRunnerFile}>Remove {runnerFile.name} ({`${(runnerFile.size / 1024).toFixed(2)} KB`})</button>
                ) : ( // if no file, show upload button
                  <label className="btn">
                    <UploadIcon /> Upload Runner Script (.py or .ps1)
                    <input type="file" accept=".py, .ps1" onChange={handleFileChange} style={{ display: "none" }} />
                  </label>
                )}

                <button className="btn" type="button"><UploadIcon /> Upload Config</button>
                <button className="btn" type="button" onClick={() => navigate('/configuration-settings')}><SettingsIcon /> Configure Settings</button>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleStartRun}><RunIcon /> Start Test Run</button>
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
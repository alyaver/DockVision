import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import '../NavBar.css';
import { useState } from "react";
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


const Dashboard = () => {
  const navigate = useNavigate();
  const [testName, setTestName] = useState("");
  const [Notify, setNotify] = useState([]);
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


  function pushNotify(type, title, msg) {
    const id = crypto.randomUUID();
    setNotify((n) => [...n, { id, type, title, msg }]);
  }

  /*
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
                onChange={e => setTestName(e.target.value)}
                placeholder="Name #1"
              />
              {errors.testName && (
                <p className="error-text">{errors.testName}</p>
              )}

              <div className="form-stack">
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

                <button className="btn" type="button" onClick={() => navigate('/configuration-settings')}><SettingsIcon /> Configure Settings</button>
              </div>
              <button className="btn btn-primary" type="button" onClick={handleStartRun} disabled={!isValid} ><RunIcon /> Start Test Run</button>
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
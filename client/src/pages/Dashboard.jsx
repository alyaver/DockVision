import Navigation from '../components/Navigation';
import { UploadIcon, RunIcon, SettingsIcon, EmptyIcon } from '../components/Icons';
import '../Dashboard.css';
import { useState } from "react";

//filers for test 
 const RECENT_RUNS = [
        { id: "a", name: "Test Run A", date: "xx/xx/xxxx" },
        { id: "b", name: "Test Run B", date: "xx/xx/xxxx" },
        { id: "c", name: "Test Run C", date: "xx/xx/xxxx" },
        { id: "d", name: "Test Run D", date: "xx/xx/xxxx" },
        { id: "e", name: "Test Run E", date: "xx/xx/xxxx" },
        ];


const Dashboard = () => {

  const [testName, setTestName] = useState("");
  const [Notify, setNotify] = useState([]);
  const dismissNotify = (id) => setNotify(n => n.filter(x => x.id !== id));

  return (
    <>
      <Navigation />
         <div className="dash-hero">
          <h1 className="dash-welcome">
            Welcome <span>(Username)</span>
          </h1>
        </div>

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
              {/*Buttons dont do anything currently needs to have funtions  */}
              <div className="form-stack">
                <button className="btn"><UploadIcon /> Upload Runner Script</button>
                <button className="btn"><UploadIcon /> Upload Config</button>
                <button className="btn"><SettingsIcon /> Configure Settings</button>
              </div>
              <button className="btn btn-primary"><RunIcon /> Start Test Run</button> 
              {/* the button need to have a function for handles startRun when clicked  that also sends notifications */}
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
                    <button className="run-open">Open</button>
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
              <button className="Notify-close" onClick={() => dismissNotify(t.id)}>×</button>
            </div>
          ))}
        </div>
      
            
       
    </>
  );
}

export default Dashboard;
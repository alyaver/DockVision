import { useEffect, useState} from "react";
import Navigation from "../../components/Navigation";
import { useNavigate } from "react-router-dom";
import "../../TestPage.css";

function TestPage() {

    const navigate = useNavigate();

    // dummy logs
    const testLogs = [
        'Container started',
        'Launching Service...',
        'Connected to DB'
    ];
    
    const [logs, setLogs] = useState([]);

    // adds logs to page
    const rollingLog = () => {
        let i = 0;

        const interval = setInterval(() => {
            if (i < testLogs.length) {

                // display next log
                setLogs((prev) => [...prev, testLogs[i]]);

                i++;
            }
            else { 
                clearInterval(interval);
            }
        }, 1000);

        return interval;
    };

    useEffect(() => {
        const interval = rollingLog();

        return () => clearInterval(interval)
        
    }, []);

    return (
        <>
            <Navigation />

            <div className="Dashboard-wrapper">
              <main className="Dashboard-page">
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Running Test</div>
                  </div>

                  <button className="btn" type="button" onClick={() => navigate('/dashboard')}>
                    Return to Dashboard
                  </button>

                    <p>Run ID: 12345</p>
                    <p>Elapsed Time: 12:34</p>
                    <p>ETA: 56:78</p>

                    <h3>Running Tests</h3>
                    <ul>
                        <li>Test1: Passed</li>
                        <li>Warning</li>
                        <li>Running</li>
                        <li>Waiting...</li>
                    </ul>

                    <h3>Live Log Panel</h3>
                    <div style={{ border: '1px solid black', padding: '10px', minHeight: '120px' }}>
                        {logs.map((log, index) => (
                            <p key={index}>{log}</p>
                        ))}
                    </div>

                    <h3>Latest Screenshot</h3>
                    <div style={{ border: '1px solid black', height: '150px', width: '250px' }}>
                        (placeholder)
                    </div>

                </div>
              </main>
            </div>
        </>
    );
}

export default TestPage;


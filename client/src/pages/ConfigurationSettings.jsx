import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Navigation from "../components/Navigation";
import "../ConfigurationSettings.css";

const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";

// get current run from sessionStorage
function readStoredRun() {
  try {
    const rawValue = sessionStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

// add new values to the saved run details
function writeStoredRun(nextValues) {
  const existingRun = readStoredRun() ?? {};
  const updatedRun = { ...existingRun, ...nextValues };
  sessionStorage.setItem(CURRENT_RUN_STORAGE_KEY, JSON.stringify(updatedRun));
}

function ConfigurationSettings() {
  const navigate = useNavigate();

  const [captureFrequency, setCaptureFrequency] = useState("Every 5 sec");
  const [iterations, setIterations] = useState("");
  const [error, setError] = useState("");

  // restores saved run details if page is left due to navigation or refreshed
  useEffect(() => {
    const storedRun = readStoredRun();
    const savedOptions = storedRun?.runOptions;

    if (savedOptions) {
      // need to match the saved seconds to the correct label
      const labelBySeconds = {
        5: "Every 5 sec",
        10: "Every 10 sec",
        30: "Every 30 sec",
        60: "Every 1 min",
      };

      const savedLabel = labelBySeconds[savedOptions.captureIntervalSeconds];

      if (savedLabel) {
        setCaptureFrequency(savedLabel);
      }

      if (savedOptions.iterations != null) {
        setIterations(savedOptions.iterations);
      }
    }
  }, []);

  const handleSubmit = () => {
    const parsedIterations = Number(iterations);

    if (
      !Number.isInteger(parsedIterations) ||
      parsedIterations < 1 ||
      parsedIterations > 30
    ) {
      setError("Please enter an integer between 1 and 30.");
      return;
    }

    setError("");

    // display label to interval in seconds
    const secondsByLabel = {
      "Every 5 sec": 5,
      "Every 10 sec": 10,
      "Every 30 sec": 30,
      "Every 1 min": 60,
    };

    // each display label should be converted to seconds, 1min -> 60secs
    const toSeconds = secondsByLabel[captureFrequency];

    console.log("Selected interval: ", toSeconds)
    console.log("Selected iterations ", parsedIterations)

    console.log("iterations", typeof parsedIterations)

    writeStoredRun({
      runOptions: {
        iterations: parsedIterations,
        captureIntervalSeconds: toSeconds,
        iterationTimeoutSeconds: 300,
      },
    });

    navigate("/dashboard", {
      state: {
        captureIntervalSeconds: toSeconds,
        iterations: parsedIterations,
      },
    });
  };

  return (
    <>
      {}
      <Navigation />

      <main className="page">
        <section className="card">
          <h1 className="title">Configuration Settings</h1>

          <div className="form-row">
            <label htmlFor="capture-frequency">Capture Screenshots</label>
            <select
              id="capture-frequency"
              value={captureFrequency}
              onChange={(e) => setCaptureFrequency(e.target.value)}
            >
              <option>Every 5 sec</option>
              <option>Every 10 sec</option>
              <option>Every 30 sec</option>
              <option>Every 1 min</option>
            </select>
          </div>

          <div className="text-input">
            <label htmlFor="text-box-count">Number of Iterations</label>
            <input
              id="text-box-count"
              type="number"
              min="1"
              max="30"
              step="1"
              value={iterations}
              onChange={(e) => setIterations(e.target.value)}
              placeholder="1-30"
            />
          </div>

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="return-button"
            onClick={handleSubmit}
          >
            Continue
          </button>
        </section>
      </main>
    </>
  );
}

export default ConfigurationSettings;
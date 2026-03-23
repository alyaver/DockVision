import { useNavigate } from "react-router-dom";
import { useState } from "react";
import Navigation from "../components/Navigation";
import "../ConfigurationSettings.css";

function ConfigurationSettings() {
  const navigate = useNavigate();

  const [captureFrequency, setCaptureFrequency] = useState("Every 5 sec");
  const [iterations, setIterations] = useState("");
  const [error, setError] = useState("");

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

    navigate("/dashboard", {
      state: {
        captureFrequency,
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
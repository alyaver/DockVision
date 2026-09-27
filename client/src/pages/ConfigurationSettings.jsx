import { useNavigate } from "react-router-dom";
import { useState } from "react";
import Navigation from "../components/Navigation";
import "../ConfigurationSettings.css";

const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";

function ConfigurationSettings() {
  const navigate = useNavigate();

  const [captureFrequency, setCaptureFrequency] =
    useState("Every 5 sec");

  const [iterations, setIterations] =
    useState("");

  const [error, setError] =
    useState("");

  function getCaptureIntervalSeconds(value) {
    switch (value) {
      case "Every 10 sec":
        return 10;

      case "Every 30 sec":
        return 30;

      case "Every 1 min":
        return 60;

      case "Every 5 sec":
      default:
        return 5;
    }
  }

  function readStoredRun() {
    try {
      const rawValue =
        sessionStorage.getItem(
          CURRENT_RUN_STORAGE_KEY
        );

      return rawValue
        ? JSON.parse(rawValue)
        : {};
    } catch {
      return {};
    }
  }

  function writeStoredSettings({
    iterations,
    captureIntervalSeconds,
  }) {
    const existingRun = readStoredRun();

    sessionStorage.setItem(
      CURRENT_RUN_STORAGE_KEY,
      JSON.stringify({
        ...existingRun,
        iterations,
        captureIntervalSeconds,
      })
    );
  }

  const handleSubmit = () => {
    const parsedIterations =
      Number(iterations);

    if (
      !Number.isInteger(parsedIterations) ||
      parsedIterations < 1 ||
      parsedIterations > 30
    ) {
      setError(
        "Please enter an integer between 1 and 30."
      );

      return;
    }

    setError("");

    const captureIntervalSeconds =
      getCaptureIntervalSeconds(
        captureFrequency
      );

    writeStoredSettings({
      iterations: parsedIterations,
      captureIntervalSeconds,
    });

    navigate("/dashboard");
  };

  return (
    <>
      <Navigation />

      <main className="page">
        <section className="card">
          <h1 className="title">
            Configuration Settings
          </h1>

          <div className="form-row">
            <label htmlFor="capture-frequency">
              Capture Screenshots
            </label>

            <select
              id="capture-frequency"
              value={captureFrequency}
              onChange={(event) =>
                setCaptureFrequency(
                  event.target.value
                )
              }
            >
              <option>Every 5 sec</option>
              <option>Every 10 sec</option>
              <option>Every 30 sec</option>
              <option>Every 1 min</option>
            </select>
          </div>

          <div className="text-input">
            <label htmlFor="text-box-count">
              Number of Iterations
            </label>

            <input
              id="text-box-count"
              type="number"
              min="1"
              max="30"
              step="1"
              value={iterations}
              onChange={(event) =>
                setIterations(
                  event.target.value
                )
              }
              placeholder="1-30"
            />
          </div>

          {error && (
            <p className="error">
              {error}
            </p>
          )}

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
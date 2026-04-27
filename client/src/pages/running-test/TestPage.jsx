import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navigation from "../../components/Navigation";
import "./TestPage.css";

const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";
const POLL_INTERVAL_MS = 3000;

function readStoredRun() {
  try {
    const rawValue = sessionStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "Not yet available";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString();
}

function formatStatus(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function TestPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const storedRun = readStoredRun();
  const runId = location.state?.runId || storedRun?.runId || null;
  const fallbackTestName =
    location.state?.testName || storedRun?.testName || "Untitled Test Run";

  const [run, setRun] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(runId));
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!runId) {
      setIsLoading(false);
      return undefined;
    }

    let isMounted = true;
    let isFirstRequest = true;

    async function fetchRun() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || "Failed to load the active run.");
        }

        if (!isMounted) {
          return;
        }

        setRun(data.run || null);
        setErrorMessage("");
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error.message || "Failed to load the active run.");
      } finally {
        if (isMounted && isFirstRequest) {
          setIsLoading(false);
          isFirstRequest = false;
        }
      }
    }

    fetchRun();
    const intervalId = window.setInterval(fetchRun, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [runId]);

  if (!runId) {
    return (
      <>
        <Navigation />
        <div className="TestPage">
          <div className="TestPage__emptyState">
            <h1>No Active Run</h1>
            <p>Start a test run from the dashboard to see its isolated task files here.</p>
            <button onClick={() => navigate("/dashboard")}>Return to Dashboard</button>
          </div>
        </div>
      </>
    );
  }

  const screenshotArtifact = run?.artifacts?.screenshot || null;
  const artifactEntries = Object.entries(run?.artifacts || {});
  const logLines = run?.logs?.task || [];

  return (
    <>
      <Navigation />
      <div className="TestPage">
        <div className="TestPage__hero">
          <div>
            <p className="TestPage__eyebrow">Running Test</p>
            <h1>{run?.testName || fallbackTestName}</h1>
            <p className="TestPage__subtitle">
              This page only reads the scoped folder for run <code>{runId}</code>.
            </p>
          </div>

          <div className="TestPage__heroActions">
            <button onClick={() => navigate("/dashboard")}>Return to Dashboard</button>
            <div className={`TestPage__statusBadge status-${run?.status || "unknown"}`}>
              {formatStatus(run?.status)}
            </div>
          </div>
        </div>

        {errorMessage && <p className="TestPage__error">{errorMessage}</p>}

        {isLoading ? (
          <div className="TestPage__panel">
            <p>Loading isolated run data...</p>
          </div>
        ) : (
          <div className="TestPage__grid">
            <section className="TestPage__panel">
              <h2>Run Details</h2>
              <dl className="TestPage__details">
                <div>
                  <dt>Run ID</dt>
                  <dd>{runId}</dd>
                </div>
                <div>
                  <dt>Container ID</dt>
                  <dd>{run?.containerId || storedRun?.containerId || "Not available"}</dd>
                </div>
                <div>
                  <dt>Task Type</dt>
                  <dd>{run?.taskType || "unknown"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(run?.createdUtc)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatTimestamp(run?.startedUtc)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatTimestamp(run?.finishedUtc)}</dd>
                </div>
                <div>
                  <dt>Cleanup Rule</dt>
                  <dd>{run?.cleanupPolicy || "Not available"}</dd>
                </div>
              </dl>

              {run?.result?.message && (
                <div className="TestPage__note">
                  <strong>Latest Result</strong>
                  <p>{run.result.message}</p>
                </div>
              )}
            </section>

            <section className="TestPage__panel">
              <h2>Scoped Paths</h2>
              <div className="TestPage__pathList">
                <p>
                  <strong>Run Root</strong>
                  <code>{run?.paths?.runRoot || "Waiting for backend..."}</code>
                </p>
                <p>
                  <strong>Task File</strong>
                  <code>{run?.paths?.taskPath || "Waiting for backend..."}</code>
                </p>
                <p>
                  <strong>Result File</strong>
                  <code>{run?.paths?.resultPath || "Waiting for backend..."}</code>
                </p>
                <p>
                  <strong>Logs Folder</strong>
                  <code>{run?.paths?.logsRoot || "Waiting for backend..."}</code>
                </p>
                <p>
                  <strong>Screenshots Folder</strong>
                  <code>{run?.paths?.screenshotsRoot || "Waiting for backend..."}</code>
                </p>
                <p>
                  <strong>Artifacts Folder</strong>
                  <code>{run?.paths?.artifactsRoot || "Waiting for backend..."}</code>
                </p>
              </div>
            </section>

            <section className="TestPage__panel TestPage__panel--wide">
              <div className="TestPage__panelHeader">
                <h2>Run Log</h2>
                <span>{logLines.length} entries</span>
              </div>

              <div className="TestPage__logBox">
                {logLines.length ? (
                  logLines.map((line) => <p key={line}>{line}</p>)
                ) : (
                  <p>No run-specific log entries yet.</p>
                )}
              </div>
            </section>

            <section className="TestPage__panel">
              <div className="TestPage__panelHeader">
                <h2>Latest Screenshot</h2>
                {screenshotArtifact?.url && (
                  <a href={screenshotArtifact.url} target="_blank" rel="noreferrer">
                    Open Full Size
                  </a>
                )}
              </div>

              {screenshotArtifact?.url ? (
                <img
                  className="TestPage__screenshot"
                  src={screenshotArtifact.url}
                  alt={`Latest screenshot for ${runId}`}
                />
              ) : (
                <div className="TestPage__placeholder">
                  Screenshot will appear here once the agent writes to this run folder.
                </div>
              )}
            </section>

            <section className="TestPage__panel">
              <div className="TestPage__panelHeader">
                <h2>Artifacts</h2>
                <span>{artifactEntries.length}</span>
              </div>

              {artifactEntries.length ? (
                <ul className="TestPage__artifactList">
                  {artifactEntries.map(([name, artifact]) => (
                    <li key={name}>
                      <strong>{name}</strong>
                      <span>{artifact.fileName || artifact.rawPath || "Not available"}</span>
                      {artifact.url ? (
                        <a href={artifact.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        <span className="TestPage__muted">Pending</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="TestPage__muted">
                  No scoped artifacts yet. If the guest agent is running, this section will
                  populate as soon as the task completes.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

export default TestPage;

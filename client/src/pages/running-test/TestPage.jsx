import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Navigation from "../../components/Navigation";
import { getRun, cancelRun } from "../../lib/api";
import "./TestPage.css";

const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";
const POLL_INTERVAL_MS = 3000;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLLING_STATUSES = new Set(["queued", "running", "cancelling"]);

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

  return String(value)
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatElapsedTime(startUtc, endUtc = null) {
  if (!startUtc) {
    return "Not started";
  }

  const start = new Date(startUtc).getTime();
  if (Number.isNaN(start)) {
    return "Not started";
  }

  const end = endUtc ? new Date(endUtc).getTime() : Date.now();
  if (Number.isNaN(end)) {
    return "Not started";
  }

  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

function isPollingStatus(status) {
  return POLLING_STATUSES.has(String(status || "").toLowerCase());
}

function getResultMessage(run) {
  if (!run) {
    return "";
  }
  if (run.result?.message) {
    return run.result.message;
  }
  if (run.result?.error?.message) {
    return run.result.error.message;
  }
  if (run.result?.error?.code) {
    return `Error code: ${run.result.error.code}`;
  }
  return "";
}

function LogPanel({ title, lines, emptyMessage }) {
  return (
    <section className="TestPage__panel">
      <div className="TestPage__panelHeader">
        <h2>{title}</h2>
        <span>{lines.length} entries</span>
      </div>

      <div className="TestPage__logBox">
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <p key={`${title}-${index}`}>{line}</p>
          ))
        ) : (
          <p className="TestPage__muted">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
}

function TestPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams();

  const storedRun = readStoredRun();
  const runId = routeRunId || location.state?.runId || storedRun?.runId || null;
  const fallbackTestName =
    location.state?.testName || storedRun?.testName || "Untitled Test Run";

  const [run, setRun] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(runId));
  const [errorMessage, setErrorMessage] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const pollTimerRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!runId) {
      setIsLoading(false);
      setRun(null);
      setErrorMessage("");
      setNetworkNotice("");
      return undefined;
    }

    let isMounted = true;
    let isFetchPending = false;

    const clearTimer = () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    const scheduleNextPoll = (nextStatus) => {
      if (!isMounted) {
        return;
      }

      if (isPollingStatus(nextStatus)) {
        clearTimer();
        pollTimerRef.current = window.setTimeout(() => {
          fetchRun();
        }, POLL_INTERVAL_MS);
      } else {
        clearTimer();
      }
    }

    async function fetchRun() {
      if (!isMounted || isFetchPending) {
        return;
      }

      isFetchPending = true;
      setIsLoading(true);

      try {
        const data = await getRun(runId);

        if (!isMounted) {
          return;
        }

        const nextRun = data?.run || null;

        if (nextRun?.runId) {
          sessionStorage.setItem(CURRENT_RUN_STORAGE_KEY,
            JSON.stringify({
              runId: nextRun.runId,
              testName: nextRun.testName || fallbackTestName,
            })
          );
        }

        setRun(nextRun);
        setErrorMessage("");
        setNetworkNotice("");

        //If the run we are working with has been terminated, stop polling
        if (nextRun && isTerminalStatus(nextRun.status)) {
          scheduleNextPoll(nextRun.status);
          return;
        }

        //if run isn't yet terminated, continue polling
        scheduleNextPoll(nextRun?.status || "queued");
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (error.status === 404) {
          setRun(null);
          setErrorMessage("This run is missing or expired. Please return to the dashboard.");
          setNetworkNotice("");
          clearTimer();
          return;
        }
        
        setNetworkNotice("Temporary network issue. Retrying for the latest run status.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
        isFetchPending = false;
      }
    }

    fetchRun();
    const intervalId = window.setInterval(fetchRun, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearTimer();
    };
  }, [runId, fallbackTestName]);

  async function handleCancel() {
    if (!runId || isCancelling || isTerminalStatus(run?.status)) {
      return;
    }

    setIsCancelling(true);
    setCancelError("");

    try {
      const data = await cancelRun(runId);

      if (data?.run) {
        setRun(data?.run);
      }
    } catch (error) {
      if (error.status === 404) {
        setErrorMessage("This run is missing or expired. Return to the dashboard.");
      } else {
        setCancelError(
          error.message || "Could not request cancellation. Please try again."
        );
      }
    } finally {
      setIsCancelling(false);
    }
  }

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

  const statusLabel = formatStatus(run?.status);
  const statusClass = run?.status ? `status-${String(run.status).toLowerCase()}` : "status-unknown";
  const screenshotArtifact = run?.artifacts?.screenshot || null;
  const artifactEntries = Object.entries(run?.artifacts || {});
  const logLines = run?.logs?.task || [];
  const taskLogs = Array.isArray(run?.logs?.task) ? run.logs.task : [];
  const stdoutLogs = Array.isArray(run?.logs?.stdout) ? run.logs.stdout : [];
  const stderrLogs = Array.isArray(run?.logs?.stderr) ? run.logs.stderr : [];
  const finalResultMessage = getResultMessage(run);

  const progress = run?.progress ?? {};
  const isBuiltinExecution = run?.executionMode === "builtin";

  const iterationLabel =
    progress.currentIteration != null && progress.totalIterations != null
      ? `${progress.currentIteration} / ${progress.totalIterations}`
      : "Unknown";

  const currentStepLabel =
    progress.currentStepNumber != null && progress.totalSteps != null
      ? `${progress.currentStepNumber} / ${progress.totalSteps}`
      : "Unknown";

  const elapsedTime = run?.startedUtc
    ? formatElapsedTime(run.startedUtc, run.finishedUtc || undefined)
    : "Not started";

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

            {!isTerminalStatus(run?.status) && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                className="TestPage__cancelButton"
              >
                {isCancelling ? "Cancelling..." : "Cancel"}
              </button>
            )}

            <div className={`TestPage__statusBadge ${statusClass}`}>
              {statusLabel}
            </div>
          </div>
        </div>

        {errorMessage && <p className="TestPage__error">{errorMessage}</p>}
        {networkNotice && <p className="TestPage__error">{networkNotice}</p>}
        {cancelError && <p className="TestPage__error">{cancelError}</p>}

        {isLoading && !run ? (
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
                <div>
                  <dt>Elapsed</dt>
                  <dd>{elapsedTime}</dd>
                </div>
              </dl>

              {finalResultMessage && (
                <div className="TestPage__note">
                  <strong>Latest Result</strong>
                  <p>{finalResultMessage}</p>
                </div>
              )}
            </section>
            
            <section className="TestPage__panel">
              <h2>Progress</h2>

              <dl className="TestPage__progressDetails">
                <div>
                  <dt>Iteration</dt>
                  <dd>{iterationLabel}</dd>
                </div>

                <div>
                  <dt>Completed Iterations</dt>
                  <dd>{progress.completedIterations ?? "Unknown"}</dd>
                </div>

                <div>
                  <dt>Current Step</dt>
                  <dd>
                    {isBuiltinExecution || progress.currentStepNumber != null
                      ? currentStepLabel
                      : "Unknown"}
                  </dd>
                </div>

                <div>
                  <dt>Completed Steps in This Iteration</dt>
                  <dd>{progress.completedSteps ?? "Unknown"}</dd>
                </div>

                <div>
                  <dt>Current Step ID</dt>
                  <dd>{progress.currentStepId ?? "Unknown"}</dd>
                </div>
              </dl>
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

            <LogPanel
              title="Task Log"
              lines={taskLogs}
              emptyMessage="No task log entries yet."
            />

            <LogPanel
              title="Stdout"
              lines={stdoutLogs}
              emptyMessage="No stdout output was returned."
            />
            
            <LogPanel
              title="Stderr"
              lines={stderrLogs}
              emptyMessage="No stderr output was returned."
            />

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

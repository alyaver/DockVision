import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Navigation from "../../components/Navigation";
import { getRun, cancelRun } from "../../lib/api";
import { getRunExport, saveFinalizedRunExport, changeRunExportDestination } from "../../lib/exportDestination.mjs";
import {
  CURRENT_RUN_STORAGE_KEY,
  clearStoredRunIfMatches,
} from "../../lib/currentRunStorage.mjs";
import "./TestPage.css";

const POLL_INTERVAL_MS = 3000;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLLING_STATUSES = new Set(["queued", "running", "cancelling"]);

function readStoredRun() {
  // restore the most recently viewed run when the page is opened without route state
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
  // convert a run's timestamps into the short elapsed-time label displayed by the page
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

function isCancellingStatus(status) {
  return String(status || "").toLowerCase() === "cancelling";
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

function flattenArtifactEntries(artifacts) {
  return Object.entries(artifacts || {}).flatMap(([name, artifact]) => {
    const values = Array.isArray(artifact) ? artifact : [artifact];

    return values.map((value, index) => ({
      name: values.length > 1 ? `${name} ${index + 1}` : name,
      key: `${name}-${index}`,
      artifact: value || {},
    }));
  });
}

// Display only the filename, never a host directory.
function artifactFilename(artifact) {
  return (
    String(artifact.fileName || artifact.relativePath || "artifact")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "artifact"
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
  const cancelPendingRef = useRef(false);
  const [cancelNotice, setCancelNotice] = useState("");
  const [exportStatus, setExportStatus] = useState("Loading");
  const [exportMessage, setExportMessage] = useState("");
  const [exportAccount, setExportAccount] = useState(null); // Associate export work with the authenticated account and current run.
  const [exportRetry, setExportRetry] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [isChoosingExport, setIsChoosingExport] = useState(false);

  // Polling replaces the run object. Keep its latest value without restarting
  // an export every time a new polling response arrives.
  const latestRunRef = useRef(run);
  latestRunRef.current = run;

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
      setCancelNotice("");
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

        // terminal runs stop scheduling new polls because their final result is already available
        if (nextRun && isTerminalStatus(nextRun.status)) {
          setCancelNotice("");
          scheduleNextPoll(nextRun.status);
          return;
        }

        // queued and active runs continue polling so the page shows their latest state
        scheduleNextPoll(nextRun?.status || "queued");
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (error.status === 404) {
          clearStoredRunIfMatches(sessionStorage, runId);
          setRun(null);
          setErrorMessage("This run is not available for this account. Please return to the dashboard.");
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
      window.clearInterval(intervalId);
    };
  }, [runId, fallbackTestName]);

useEffect(() => {
    if (!runId) return;

    const controller = new AbortController();
    let isMounted = true;

    setExportAccount(null);
    setExportStatus("Loading");
    setExportMessage("");

    async function loadExportChoice() {
      try {
        // Use the authenticated account to read its browser-stored choice.
        const response = await fetch("/api/auth/me", {
          credentials: "include",
          signal: controller.signal,
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.user?.user_id == null) {
          throw new Error("Sign in to load this run's export choice.");
        }

        const choice = await getRunExport(data.user.user_id, runId);

        if (!isMounted) return;

        // Allow automatic export only after this account's choice has loaded.
        setExportAccount({
          userId: data.user.user_id,
          runId,
          directory: choice?.directory ?? null,
        });

        if (!choice) {
          setExportStatus("Not configured");
          setExportMessage(
            "No export choice was remembered for this run. Use the artifact Download actions when available."
          );
          return;
        }

        setExportStatus(formatStatus(choice.status));

        if (choice.status === "disabled") {
          setExportMessage(
            "Artifacts will not be automatically saved to this device."
          );
        } else if (choice.status === "pending") {
          setExportMessage(
            "Automatic export is pending. No files have been saved to your selected folder yet."
          );
        }
      } catch (error) {
        if (!isMounted || error.name === "AbortError") return;

        // Loading an export preference must not change execution status.
        setExportStatus("Unavailable");
        setExportMessage(
          "Could not load the export choice. Refresh to retry. This does not change the test's execution status."
        );
      }
    }

    loadExportChoice();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [runId]);

  useEffect(() => {
  if (
    exportAccount?.runId !== runId ||
    run?.runId !== runId ||
    !isTerminalStatus(run?.status) ||
    run?.artifactsFinalized !== true
  ) {
    return;
  }

  const controller = new AbortController();
  let isMounted = true;

  async function exportArtifacts() {
    try {
      const choice = await getRunExport(exportAccount.userId, runId);

      if (!isMounted || !choice) return;

      // Start pending exports automatically. Failed exports require Retry.
      const shouldSave =
        choice.status === "pending" ||
        (choice.status === "failed" && exportRetry > 0);

      if (!shouldSave) {
        setExportStatus(formatStatus(choice.status));

        if (choice.message) {
          setExportMessage(choice.message);
        }

        return;
      }

      setExportStatus("Saving");
      setExportMessage(
        "Saving artifacts to your selected folder. Keep this page open until export finishes."
      );

      const result = await saveFinalizedRunExport(
        exportAccount.userId,
        latestRunRef.current,
        { signal: controller.signal }
      );

      if (!isMounted || !result) return;

      // Update export presentation only; never change the execution result.
      setExportStatus(formatStatus(result.status));
      setExportMessage(result.message || "");
    } catch (error) {
      if (!isMounted || controller.signal.aborted) return;

      setExportStatus("Failed");
      setExportMessage(
        error.message ||
          "Export could not finish. You can still download artifacts manually."
      );
    }
  }

  exportArtifacts();

  return () => {
    isMounted = false;
    controller.abort();
  };
  }, [
    runId,
    run?.runId,
    run?.status,
    run?.artifactsFinalized,
    exportAccount,
    exportRetry,
  ]);

  async function handleRecoverExportFolder() {
  if (!exportAccount || isChoosingExport || exportStatus === "Saving") return;

  if (typeof window.showDirectoryPicker !== "function") {
    setExportMessage(
      "Folder saving is unavailable in this browser. Use the artifact Download actions."
    );
    return;
  }

  setIsChoosingExport(true);

  try {
    // Open directly from this click so the browser can request authorization.
    const directory = await window.showDirectoryPicker({
      mode: "readwrite",
      ...(exportAccount.directory
        ? { startIn: exportAccount.directory }
        : {}),
    });

    const record = await changeRunExportDestination(
      exportAccount.userId,
      runId,
      directory
    );

    setExportStatus(formatStatus(record.status));
    setExportMessage(record.message || "");

    // Changing this account context triggers the existing export effect.
    setExportAccount((previous) => ({
      ...previous,
      directory: record.directory,
    }));
  } catch (error) {
    if (error.name === "AbortError") return;

    if (error.name === "NotFoundError" || error.name === "TypeError") {
      // Let the next explicit click open without an unavailable starting folder.
      setExportAccount((previous) => ({
        ...previous,
        directory: null,
      }));

      setExportMessage(
        "The previous folder is unavailable. Click Choose or authorize export folder again and select an existing writable folder."
      );
    } else {
      setExportMessage(
        "Could not authorize that destination. Choose an existing writable folder and allow access. You can still download artifacts manually."
      );
    }
  } finally {
    setIsChoosingExport(false);
  }
}

  async function handleDownloadArtifact(artifact) {
    setDownloadError("");

    try {
      // Fetch the file with the signed-in session before downloading it.
      const response = await fetch(artifact.url, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("The artifact could not be downloaded.");
      }

      const contents = await response.blob();
      const objectUrl = URL.createObjectURL(contents);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = artifactFilename(artifact);
      document.body.appendChild(link);

      try {
        link.click();
      } finally {
        link.remove();

        // Release the temporary URL after the browser starts the download.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch {
      setDownloadError(
        "Could not download this artifact. Check your connection and try again."
      );
    }
  }

  async function handleCancel() {
    if (!runId ||
      cancelPendingRef.current || 
      isCancelling || 
      isTerminalStatus(run?.status) ||
      isCancellingStatus(run?.status)
    ){
      return;
    }

    //setting the ref to prevent duplicate clicks.
    cancelPendingRef.current = true;
    setIsCancelling(true);
    setCancelError("");
    setErrorMessage("");
    setCancelNotice("");

    try {
      const data = await cancelRun(runId);

      if (data?.run) {
        setRun(data?.run);

        if (isTerminalStatus(data.run.status)){
          setCancelNotice("");
        } else {
          setCancelNotice(data.message || "Cancellation Requested");
        }
      } else {
        setCancelNotice(data?.message || "Cancellation Requested");
      }
    } catch (error) {
      if (error.status === 404) {
        clearStoredRunIfMatches(sessionStorage, runId);
        setRun(null);
        setCancelNotice("");
        setErrorMessage("This run is not available for this account. Return to the dashboard.");
      } else {
        setCancelError(
          error.message || "Could not request cancellation. Please try again."
        );
      }
    } finally {
      cancelPendingRef.current = false;
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
  const screenshotArtifacts = run?.artifacts?.screenshot || null;
  const screenshotArtifact = run?.artifacts?.screenshot ||
    (Array.isArray(screenshotArtifacts) ? screenshotArtifacts.at(-1) : null);
  const artifactEntries = Object.entries(run?.artifacts || {}).filter(
    ([name]) => name !== "screenshot"
  );
  const logLines = run?.logs?.task || [];
  const taskLogs = Array.isArray(run?.logs?.task) ? run.logs.task : [];
  const stdoutLogs = Array.isArray(run?.logs?.stdout) ? run.logs.stdout : [];
  const stderrLogs = Array.isArray(run?.logs?.stderr) ? run.logs.stderr : [];
  const finalResultMessage = getResultMessage(run);

  const progress = run?.progress ?? {};
  const isBuiltinExecution = run?.executionMode === "builtin";

  const iterationLabel =
    progress.currentIteration != null && progress.totalIterations != null
      ? `${progress.currentIteration} of ${progress.totalIterations}`
      : "Unknown";

  const currentStepLabel =
    progress.currentStepNumber != null && progress.totalSteps != null
      ? `${progress.currentStepNumber} of ${progress.totalSteps}`
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
                disabled={isCancelling || isCancellingStatus(run?.status)}
                className="TestPage__cancelButton"
              >
                {isCancelling || isCancellingStatus(run?.status)
                ? "Cancelling..."
                 : "Cancel"}
              </button>
            )}

            <div className={`TestPage__statusBadge ${statusClass}`}>
              {statusLabel}
            </div>
          </div>
        </div>

        {/* Display export progress independently of the run status badge. */}
        <section className="TestPage__panel TestPage__exportPanel" aria-labelledby="export-status-title">
          <h2 id="export-status-title">Artifact Export</h2>

          <p role="status">Export status: {exportStatus}</p>

          {exportMessage && <p>{exportMessage}</p>}

          {/* Retry saving without restarting the test. */}
          {exportStatus === "Failed" && (
            <button
              type="button"
              onClick={() => setExportRetry((previous) => previous + 1)}
              disabled={isChoosingExport}
            >
              Retry export
            </button>
          )}

          {/* Recover folder access without restarting execution. */}
          {["Failed", "Needs Permission"].includes(exportStatus) && (
            <button
              type="button"
              onClick={handleRecoverExportFolder}
              disabled={isChoosingExport}
            >
              {isChoosingExport
                ? "Choosing folder..."
                : "Choose or authorize export folder"}
            </button>
          )}
        </section>

        {/* Report export setup problems separately from execution status. */}
        {location.state?.exportSetupMessage && (
          <p className="TestPage__error" role="alert">
            {location.state.exportSetupMessage}
          </p>
        )}

        {errorMessage && <p className="TestPage__error">{errorMessage}</p>}
        {networkNotice && <p className="TestPage__error">{networkNotice}</p>}
        {cancelError && <p className="TestPage__error">{cancelError}</p>}
        {cancelNotice && <p className = "TestPage__notice" role = "status">{cancelNotice}</p>}

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
{/* Remove Scoped Paths, stdout, and stderr panels
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
*/}
            <LogPanel
              title="Task Log"
              lines={taskLogs}
              emptyMessage="No task log entries yet."
            />
{/*}
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
*/}
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

              {/* Show errors from manual artifact downloads. */}
              {downloadError && <p role="alert">{downloadError}</p>}

              {artifactEntries.length ? (
                <ul className="TestPage__artifactList">
                  {artifactEntries.map(({key, artifact}) => (
                    <li key={key}>
                      <strong>{artifactFilename(artifact)}</strong>
                      {artifact.url ? (
                        <>
                          <a href={artifact.url} target="_blank" rel="noreferrer">
                            Open
                          </a>

                          <button
                            type="button"
                            className="TestPage__artifactDownload"
                            onClick={() => handleDownloadArtifact(artifact)}
                          >
                            Download
                          </button>
                        </>
                      ) : (
                        <span className="TestPage__muted">Unavailable</span>
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

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyIcon } from "./Icons";

function formatRunLabel(value) {
    return String(value || "")
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatRunTimestamp(run) {
    const label = run.finishedUtc
        ? "Finished"
        : run.startedUtc
            ? "Started"
            : "Created";
    const value = run.finishedUtc || run.startedUtc || run.createdUtc;

    if (!value) {
        return "Timestamp unavailable";
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return `${label}: ${value}`;
    }

    return `${label}: ${parsedDate.toLocaleString()}`;
}

export default function ProfileRunHistory() {
    const navigate = useNavigate();
    const [runs, setRuns] = useState([]);
    const [runsLoading, setRunsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");

    async function loadRuns() {
        setRunsLoading(true);
        setErrorMessage("");

        try {
            const response = await fetch("/api/runs", { credentials: "include" });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || "Failed to load recent runs.");
            }

            setRuns(Array.isArray(data.runs) ? data.runs : []);
        } catch (error) {
            setRuns([]);
            setErrorMessage(error.message || "Failed to load recent runs.");
        } finally {
            setRunsLoading(false);
        }
    }

    useEffect(() => {
        loadRuns();
    }, []);

    function handleOpenRun(run) {
        navigate("/running-test", {
            state: {
                runId: run.runId,
                testName: run.testName,
            },
        });
    }

    return (
        <section className="profile-run-history">
            <div className="profile-run-history-header">
                <div className="profile-run-history-title">Recent Test Runs</div>
                <button
                    className="profile-run-refresh"
                    type="button"
                    onClick={loadRuns}
                    disabled={runsLoading}
                >
                    {runsLoading ? "Loading..." : "Refresh"}
                </button>
            </div>

            {runsLoading && runs.length === 0 ? (
                <div className="profile-run-list-state" role="status">Loading recent runs...</div>
            ) : errorMessage ? (
                <div className="profile-run-list-state profile-run-list-state--error" role="alert">
                    <p>{errorMessage}</p>
                    <button className="profile-run-retry" type="button" onClick={loadRuns}>
                        Retry
                    </button>
                </div>
            ) : runs.length > 0 ? (
                <ul className="profile-run-list">
                    {runs.map((run) => {
                        return (
                            <li key={run.runId} className="profile-run-item">
                                <div className="profile-run-item-left">
                                    <div
                                        className={`profile-run-dot profile-run-dot--${String(
                                            run.status || "unknown"
                                        ).toLowerCase()}`}
                                    />
                                    <div>
                                        <div className="profile-run-name">{run.testName}</div>
                                        <div className="profile-run-meta">
                                            <span className="profile-run-badge">
                                                {formatRunLabel(run.taskType) || "Unknown"}
                                            </span>
                                            <span className="profile-run-badge">
                                                {run.totalIterations ?? 1} iteration
                                                {(run.totalIterations ?? 1) === 1 ? "" : "s"}
                                            </span>
                                            <span
                                                className={`profile-run-badge profile-run-status--${String(
                                                    run.status || "unknown"
                                                ).toLowerCase()}`}
                                            >
                                                {formatRunLabel(run.status) || "Unknown"}
                                            </span>
                                            {run.active && (
                                                <span className="profile-run-active">Active</span>
                                            )}
                                        </div>
                                        <div className="profile-run-date">{formatRunTimestamp(run)}</div>
                                        <div className="profile-run-id">Run ID: {run.runId}</div>
                                    </div>
                                </div>
                                <button
                                    className="profile-run-open"
                                    type="button"
                                    onClick={() => handleOpenRun(run)}
                                >
                                    Open
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className="profile-run-empty-state">
                    <div className="profile-run-empty-icon">
                        <EmptyIcon />
                    </div>
                    <div className="profile-run-empty-title">No recent Test Runs</div>
                    <div className="profile-run-empty-sub">
                        It&apos;s empty in here&hellip;
                        <br />
                        Start a new test run to see it appear.
                    </div>
                </div>
            )}
        </section>
    );
}
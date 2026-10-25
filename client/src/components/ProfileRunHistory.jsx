import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyIcon } from "./Icons";
import { getRun } from "../lib/api";

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

function flattenArtifactEntries(artifacts) {
    return Object.entries(artifacts || {}).flatMap(([name, artifact]) => {
        const values = Array.isArray(artifact) ? artifact : [artifact];
        return values.filter(Boolean).map((value, index) => ({
            name: values.length > 1 ? `${name}-${index + 1}` : name,
            artifact: value,
        }));
    });
}

function flattenFileEntries(files) {
    return Object.entries(files || {}).flatMap(([name, file]) => {
        const values = Array.isArray(file) ? file : [file];
        return values.filter(Boolean).map((value, index) => ({
            name: values.length > 1 ? `${name}-${index + 1}` : name,
            file: value,
        }));
    });
}

function formatArtifactGroupName(name) {
    if (name.startsWith("screenshot-")) {
        const match = name.match(/^screenshot-(\d+)-/);
        return match ? `Iteration ${match[1]} Screenshots` : "Screenshots";
    }

    return "Results";
}

export default function ProfileRunHistory() {
    const navigate = useNavigate();
    const [runs, setRuns] = useState([]);
    const [runsLoading, setRunsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [expandedRunId, setExpandedRunId] = useState("");
    const [artifactRuns, setArtifactRuns] = useState({});
    const [artifactLoadingRunId, setArtifactLoadingRunId] = useState("");
    const [artifactErrors, setArtifactErrors] = useState({});

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

    async function loadArtifacts(runId) {
        setArtifactLoadingRunId(runId);
        setArtifactErrors((previous) => ({ ...previous, [runId]: "" }));

        try {
            const data = await getRun(runId);
            setArtifactRuns((previous) => ({ ...previous, [runId]: data.run || null }));
        } catch (error) {
            setArtifactErrors((previous) => ({
                ...previous,
                [runId]: error.message || "Failed to load run artifacts.",
            }));
        } finally {
            setArtifactLoadingRunId("");
        }
    }

    async function handleToggleArtifacts(runId) {
        if (expandedRunId === runId) {
            setExpandedRunId("");
            return;
        }

        setExpandedRunId(runId);
        if (!artifactRuns[runId]) {
            await loadArtifacts(runId);
        }
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
                                <div className="profile-run-actions">
                                    <button
                                        className="profile-run-artifacts"
                                        type="button"
                                        onClick={() => handleToggleArtifacts(run.runId)}
                                        aria-expanded={expandedRunId === run.runId}
                                    >
                                        {artifactLoadingRunId === run.runId
                                            ? "Loading..."
                                            : expandedRunId === run.runId
                                                ? "Hide artifacts"
                                                : "Artifacts"}
                                    </button>
                                    <button
                                        className="profile-run-open"
                                        type="button"
                                        onClick={() => handleOpenRun(run)}
                                    >
                                        Open
                                    </button>
                                </div>
                                {expandedRunId === run.runId && (
                                    <div className="profile-run-artifact-panel">
                                        {artifactErrors[run.runId] ? (
                                            <div className="profile-run-artifact-error" role="alert">
                                                {artifactErrors[run.runId]}
                                                <button type="button" onClick={() => loadArtifacts(run.runId)}>
                                                    Retry
                                                </button>
                                            </div>
                                        ) : artifactRuns[run.runId] ? (
                                            <>
                                                {(() => {
                                                    const artifacts = artifactRuns[run.runId].artifacts || {};
                                                    const entries = flattenArtifactEntries(artifacts)
                                                        .filter(({ name }) => name !== "screenshot" && !name.startsWith("screenshot-"));
                                                    const screenshotEntries = flattenArtifactEntries(artifacts)
                                                        .filter(({ name }) => name.startsWith("screenshot-"));
                                                    const fileEntries = flattenFileEntries(artifactRuns[run.runId].files);
                                                    const groupedEntries = [
                                                        ...screenshotEntries.map((entry) => ({
                                                            ...entry,
                                                            group: formatArtifactGroupName(entry.name),
                                                            value: entry.artifact,
                                                        })),
                                                        ...entries.map((entry) => ({
                                                            ...entry,
                                                            group: "Results",
                                                            value: entry.artifact,
                                                        })),
                                                        ...fileEntries.map((entry) => ({
                                                            ...entry,
                                                            group: entry.name === "taskPlan" ? "Inputs" : "Results",
                                                            value: entry.file,
                                                        })),
                                                    ];
                                                    const groups = groupedEntries.reduce((result, entry) => {
                                                        result[entry.group] = result[entry.group] || [];
                                                        result[entry.group].push(entry);
                                                        return result;
                                                    }, {});

                                                    return (
                                                        <>
                                                            {Object.keys(groups).length > 0 ? (
                                                                Object.entries(groups).map(([groupName, groupEntries]) => (
                                                                    <div className="profile-run-artifact-group" key={groupName}>
                                                                        <h4>{groupName}</h4>
                                                                        <ul className="profile-run-artifact-list">
                                                                            {groupEntries.map(({ name, value }) => (
                                                                                <li key={name}>
                                                                                    <span>{value.displayName || value.fileName || name}</span>
                                                                                    {value.url ? (
                                                                                        (() => {
                                                                                            const isTaskPlan = name === "taskPlan";
                                                                                            return (
                                                                                        <a
                                                                                            href={isTaskPlan ? `${value.url}?download=1` : value.url}
                                                                                            target={isTaskPlan ? undefined : "_blank"}
                                                                                            rel={isTaskPlan ? undefined : "noreferrer"}
                                                                                            download={isTaskPlan ? true : undefined}
                                                                                        >
                                                                                            {isTaskPlan ? "Download" : "Open"}
                                                                                        </a>
                                                                                            );
                                                                                        })()
                                                                                    ) : (
                                                                                        <span>Pending</span>
                                                                                    )}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="profile-run-artifact-empty">No artifacts available for this run.</div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </>
                                        ) : (
                                            <div className="profile-run-artifact-loading" role="status">Loading artifacts...</div>
                                        )}
                                    </div>
                                )}
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
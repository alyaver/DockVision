import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navigation from "../components/Navigation";
import "../Profile.css";

export default function Profile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [deletionJob, setDeletionJob] = useState(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);

    async function readDeletionStatus() {
        const response = await fetch("/api/auth/deletion-status", { credentials: "include" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Unable to read deletion status.");
        setDeletionJob(data.job);
        return data.job;
    }

    useEffect(() => {
        const controller = new AbortController();

        async function loadProfile() {
            try {
                const response = await fetch("/api/auth/me", {
                    credentials: "include",
                    signal: controller.signal,
                });

                if (response.status === 401) {
                    navigate("/Login", { replace: true });
                    return;
                }

                const data = await response.json().catch(() => ({}));

                if (!response.ok || !data.user) {
                    throw new Error(
                        data.message || "Unable to load your profile. Please try again."
                    );
                }

                setUser(data.user);
                setErrorMessage("");
            } catch (error) {
                if (error.name === "AbortError") return;

                setErrorMessage(
                    error.message || "Unable to load your profile. Please try again."
                );
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        loadProfile();

        return () => controller.abort();
    }, [navigate]);

    useEffect(() => {
        let cancelled = false;
        async function loadDeletion() {
            try {
                const job = await readDeletionStatus();
                if (!cancelled && job?.status !== "completed") setDeletionJob(job);
            } catch (error) {
                if (!cancelled && error.message) setErrorMessage(error.message);
            }
        }
        loadDeletion();
        return () => { cancelled = true; };
    }, []);

    async function submitDeletion(event) {
        event.preventDefault();
        setIsDeleting(true);
        setErrorMessage("");
        try {
            const response = await fetch("/api/auth/delete-account", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password, confirmation }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || "Unable to start account deletion.");
            setPassword("");
            setConfirmation("");
            setShowDeleteDialog(false);
            setDeletionJob(data.job);
            if (data.job?.status === "completed") {
                navigate("/Login", { replace: true, state: { message: "Your DockVision account was deleted." } });
            }
        } catch (error) {
            setErrorMessage(error.message);
        } finally {
            setIsDeleting(false);
        }
    }

    async function resumeDeletion() {
        setIsDeleting(true);
        setErrorMessage("");
        try {
            const response = await fetch("/api/auth/delete-account/resume", {
                method: "POST", credentials: "include",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || "Unable to resume account deletion.");
            setDeletionJob(data.job);
            if (data.job?.status === "completed") {
                navigate("/Login", { replace: true, state: { message: "Your DockVision account was deleted." } });
            }
        } catch (error) {
            setErrorMessage(error.message);
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <>
            <Navigation />

            <main className="profile-page">
                <header className="profile-header">
                    <h1 className="profile-title">Profile Page</h1>
                </header>

                {isLoading && <p className="profile-status">Loading profile...</p>}

                {errorMessage && (
                    <p className="profile-status" role="alert">
                        {errorMessage}
                    </p>
                )}

                {user && (
                    <section className="profile-card" aria-labelledby="profile-card-title">
                        <h2 id="profile-card-title">About You</h2>
                        <dl className="profile-details">
                            <div>
                                <dt>Name</dt>
                                <dd>{user.name}</dd>
                            </div>
                            <div>
                                <dt>Email</dt>
                                <dd>{user.email}</dd>
                            </div>
                        </dl>
                    </section>
                )}

                <section className="profile-card deletion-card" aria-labelledby="delete-account-title">
                    <h2 id="delete-account-title">Delete account</h2>
                    <p>This permanently removes your account and server-stored runs owned by you. Ownerless legacy runs and files saved on your device are preserved.</p>
                    {deletionJob && deletionJob.status !== "completed" ? (
                        <div role="status">
                            <p><strong>Deletion status:</strong> {deletionJob.step || deletionJob.status}</p>
                            {deletionJob.last_error && <p role="alert">{deletionJob.last_error}</p>}
                            <button type="button" className="profile-danger-button" onClick={resumeDeletion} disabled={isDeleting}>
                                {isDeleting ? "Retrying..." : "Check status / retry"}
                            </button>
                        </div>
                    ) : (
                        <button type="button" className="profile-danger-button" onClick={() => setShowDeleteDialog(true)}>
                            Delete my account
                        </button>
                    )}
                </section>

                {showDeleteDialog && (
                    <div className="profile-dialog-backdrop" role="presentation">
                        <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
                            <h2 id="confirm-delete-title">Confirm permanent deletion</h2>
                            <p>This cannot be undone after you submit. Active work must stop safely before owned server files are removed.</p>
                            <form onSubmit={submitDeletion}>
                                <label htmlFor="delete-password">Current password</label>
                                <input id="delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
                                <label htmlFor="delete-confirmation">Type CONFIRM</label>
                                <input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="off" />
                                <div className="profile-dialog-actions">
                                    <button type="button" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>Cancel</button>
                                    <button type="submit" className="profile-danger-button" disabled={isDeleting || confirmation !== "CONFIRM"}>
                                        {isDeleting ? "Starting..." : "Permanently delete account"}
                                    </button>
                                </div>
                            </form>
                        </section>
                    </div>
                )}
            </main>
        </>
    );
}
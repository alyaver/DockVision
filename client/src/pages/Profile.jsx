import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getExportDestination, saveExportDestination, disableExportDestination } from "../lib/exportDestination.mjs";
import Navigation from "../components/Navigation";
import "../Profile.css";

export default function Profile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [exportDestination, setExportDestination] = useState(null);
    const [exportMessage, setExportMessage] = useState("");
    const [isUpdatingExport, setIsUpdatingExport] = useState(false);

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
        if (user?.user_id == null) return;

        let isMounted = true;

        getExportDestination(user.user_id)
            .then((destination) => {
                if (isMounted) setExportDestination(destination);
            })
            .catch(() => {
                if (isMounted) {
                    setExportMessage(
                        "Could not load your export destination. Choose a folder again."
                    );
                }
            });
        return () => {
            isMounted = false;
        };          
    }, [user?.user_id]);

    async function handleChangeExportFolder() {
        setExportMessage("folder button clicked.");
        if (typeof window.showDirectoryPicker !== "function") {
            setExportMessage(
                "Automatic folder saving is unavailable in this browser. Use the artifact download actions instead."
            );
            return;
        }

        if (user?.user_id == null) {
            setExportMessage("Your profile response is missing user_id.");
            return;
        }

        setIsUpdatingExport(true);


        try {
            const directory = await window.showDirectoryPicker({
                mode:"readwrite",
                ...(exportDestination?.directory
                    ? { startIn: exportDestination.directory }
                    : {}),
            });

            setExportMessage(`Selected ${directory.name}. Remembering destination…`);

            await saveExportDestination(user.user_id, directory);
            setExportDestination({ directory, enabled: true });
            setExportMessage("Export destination updated.");
        } catch (error) {
            // Display the actual error to identify why selection or saving failed.
            setExportMessage(
                `Could not remember the folder: ${error.message}: ${error.message}`
            );
            
        } finally {
            setIsUpdatingExport(false);
        }
    }

    async function handleDisableExport() {
        if (user?.user_id == null) {
            setExportMessage(
                "missing user_id"
            );
            return;
        }

        setIsUpdatingExport(true);
        setExportMessage("");

        try {
            // Disable saving while retaining the last folder for future pickers.
            await disableExportDestination(user.user_id);

            setExportDestination((previous) => ({
            ...previous,
            enabled: false,
            }));

            setExportMessage(
            "Automatic export disabled. Artifacts will not be automatically saved to this device. You can still open and download them manually."
            );
        } catch {
            setExportMessage(
            "Could not disable automatic export. Please try again."
            );
        } finally {
            setIsUpdatingExport(false);
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

                {user && (
                    <section className="profile-card" aria-labelledby="export-title">
                        <h2 id="export-title">Artifact Export</h2>

                        <p>
                            Destination: {exportDestination?.directory?.name || "None selected"}
                        </p>

                        <p>
                            Automatic export: {exportDestination?.enabled ? "Enabled" : "Disabled"}
                        </p>

                        <button
                            type="button"
                            onClick={handleChangeExportFolder}
                            disabled={isUpdatingExport}
                        >
                            Choose or change export folder
                        </button>
                        
                        <button
                            type="button"
                            onClick={handleDisableExport}
                            disabled={isUpdatingExport || !exportDestination?.enabled}
                        >
                            Disable automatic export
                        </button>

                        {exportMessage && <p role="status">{exportMessage}</p>}
                    </section>
                )}
            </main>
        </>
    );
}
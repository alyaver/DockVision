import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navigation from "../components/Navigation";
import "../Profile.css";

export default function Profile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");

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
            </main>
        </>
    );
}
import Navigation from "../components/Navigation";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../Profile.css";

export default function Profile() {

    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [name, setName] = useState("");
    const [email, setEmail] = useState()
    const [isLoading, setIsLoading] = useState(true);

    const [isEditName, setIsEditName] = useState(false);
    const [isEditEmail, setIsEditEmail] = useState(false);

    const [isSuccessMessage, setIsSuccessMessage] = useState("")
    const [isErrorMessage, setIsErrorMessage] = useState("");


    // Load current users profile
    useEffect(() => {
        async function loadProfile() {
            try {
                const response = await fetch("/api/auth/me", {
                    credentials: "include",
                });

                if (response.status === 401) {
                    navigate("/login", { replace: true });
                    return;
                }

                let data = {};

                try {
                    data = await response.json();
                } catch {
                    data = {};
                }

                if (!response.ok || !data.user) {
                    throw new Error(
                        data.message || "Unable to load your profile. Please try again."    
                    );
                }

                // save user information to display 
                setUser(data.user);

                setName(data.user.name);
                
                setEmail(data.user.email);

            
            } catch (error) {
                // if user information/data be loaded, show an error message
                setIsErrorMessage(
                    error.message || "Unable to load your profile. Please try again."
                );

            } finally {
                setIsLoading(false);
            }
        }

        loadProfile();
    }, [navigate]);

    // Update user information (frontend only, not backend atm)
    function handleSaveName(event) {
        event.preventDefault();

        const updatedName = name.trim();

        if (!updatedName) {
            setIsSuccessMessage("");
            setIsErrorMessage("Please enter your name.");
            return;
        }

        setUser((currentUser) => ({
            ...currentUser,
            name: updatedName,
        }));

        setName(updatedName);
        setIsErrorMessage("");
        setIsSuccessMessage("Name updated");
        setIsEditName(false);
    }

    function handleSaveEmail(event) {
        event.preventDefault();

        const updatedEmail = email.trim().toLowerCase();

        if (!updatedEmail) {
            setIsSuccessMessage("");
            setIsErrorMessage("Please enter your email address.");
            return;
        }

        setUser((currentUser) => ({
            ...currentUser,
            email: updatedEmail,
        }));

        setEmail(updatedEmail);
        setIsErrorMessage("");
        setIsSuccessMessage("Email updated");
        setIsEditEmail(false);
    }

    return (
        <>
            <Navigation />

            <main className="profile-page">
                <header className="profile-header">
                    <h1 className="profile-title">Profile Page</h1>
                </header>
                {isLoading && <p>Loading profile...</p>}

                {isErrorMessage && <p role="alert">{isErrorMessage}</p>}

                {user && (
                    <section className="profile-card">
                        <h1>About You</h1>

                        <div>
                            <div className="profile-field-row">
                                <p>Name: {user.name}</p>
                                
                                {!isEditName && (
                                    <button
                                    type="button"
                                    className="profile-edit-button"
                                    onClick={() => {
                                        setIsEditName(true);
                                        setIsEditEmail(false); // Does not open edit email
                                        setEmail(user.email);
                                        setIsSuccessMessage("");
                                        setIsErrorMessage("");
                                    }}
                                    >
                                        Edit
                                    </button>
                                )}

                                {isSuccessMessage === "Name updated" && (
                                    <span 
                                        role="status"
                                        style={{ color: "green" }}
                                    >
                                    {"\u2713"} {isSuccessMessage}
                                    </span>
                                )}
                            </div>

                            {isEditName && (
                                <form onSubmit={handleSaveName}>
                                    <input
                                        id="profile-name"
                                        type="text"
                                        value={name}
                                        onChange={(event) => {setName(event.target.value);}}
                                        maxLength={30}
                                        required
                                    />

                                    <div className="profile-actions">
                                        <button type="submit">Save Name</button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setName(user.name);
                                                setIsEditName(false);
                                                setIsErrorMessage("")
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            )}

                            <div className="profile-field-row">
                                <p>Email: {user.email}</p>
                                
                                {!isEditEmail && (
                                    <button
                                        type="button"
                                        className="profile-edit-button"
                                        onClick={() => {
                                            setIsEditEmail(true);
                                            setIsEditName(false);
                                            setName(user.name);
                                            setIsSuccessMessage("");
                                            setIsErrorMessage("");
                                        }}
                                    >
                                        Edit
                                    </button>
                                )}

                                {isSuccessMessage === "Email updated" && (
                                    <span 
                                        role="status"
                                        style={{ color: "green" }}
                                    >
                                    {"\u2713"} {isSuccessMessage}
                                    </span>
                                )}
                            </div>

                            {isEditEmail && (
                                <form onSubmit={handleSaveEmail}>
                                    <input
                                        id="profile-email"
                                        type="text"
                                        value={email}
                                        onChange={(event) => {setEmail(event.target.value);}}
                                        maxLength={255}
                                        required
                                    />

                                    <div className="profile-actions">
                                        <button type="submit">Save Email</button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEmail(user.email);
                                                setIsEditEmail(false);
                                                setIsErrorMessage("")
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </section>
                )}
            </main>
        </>
    )
}
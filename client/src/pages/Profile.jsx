import { useEffect, useRef, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import Navigation from "../components/Navigation";
import ProfileRunHistory from "../components/ProfileRunHistory";
import "../Profile.css";

const AVATAR_TYPES = ["image/png", "image/jpeg"];

function avatarUrl(user) {
    return user?.has_avatar
        ? `/api/profile/avatar?v=${encodeURIComponent(user.avatar_updated_at || "current")}`
        : "";
}

async function normalizeAvatar(file) {
    if (!AVATAR_TYPES.includes(file.type)) {
        throw new Error("Choose a PNG or JPEG image.");
    }

    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const imageElement = new Image();
            imageElement.onload = () => resolve(imageElement);
            imageElement.onerror = () => reject(new Error("The selected image could not be read."));
            imageElement.src = sourceUrl;
        });
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.getContext("2d").drawImage(
            image,
            (image.naturalWidth - size) / 2,
            (image.naturalHeight - size) / 2,
            size,
            size,
            0,
            0,
            size,
            size
        );
        const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outputType, 0.9);
        return { contentType: outputType, data: dataUrl.split(",")[1] };
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

function getPasswordStrength(password) {
  const checks = {
    length:     password.length >= 8,
    longEnough: password.length >= 12,
    uppercase:  /[A-Z]/.test(password),
    lowercase:  /[a-z]/.test(password),
    number:     /\d/.test(password),
    symbol:     /[!@#$%^&*]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const levels = [
    { label: '',            pct: 0,   color: '#ccc'    },
    { label: 'Very weak',   pct: 16,  color: '#E24B4A' },
    { label: 'Weak',        pct: 32,  color: '#E24B4A' },
    { label: 'Fair',        pct: 52,  color: '#EF9F27' },
    { label: 'Good',        pct: 72,  color: '#639922' },
    { label: 'Strong',      pct: 88,  color: '#1D9E75' },
    { label: 'Very strong', pct: 100, color: '#1D9E75' },
  ];
  return { checks, score, level: password.length === 0 ? levels[0] : levels[Math.max(1, score)] };
}

export default function Profile() {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    const [form, setForm] = useState({ name: "", email: "" });
    const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isChangingPasswordOpen, setIsChangingPasswordOpen] = useState(false);
    const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
    const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);

    const password = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmNewPassword;
    const name = form.name;
    const email = form.email;
    const { checks: pwChecks, score: pwScore, level: pwLevel } = getPasswordStrength(password);
    const validExtensions = [".com", ".org", ".net", ".gov", ".edu"];

    // Basic email splitting for validation rules.
    const emailParts = email.split("@");
    const localPart = emailParts.length === 2 ? emailParts[0] : "";
    const domainPart = emailParts.length === 2 ? emailParts[1] : "";

    const nameRules = [
        {
        label: "Name must be 2 to 30 characters",
        valid: name.length >= 2 && name.length <= 30,
        },
        {
        label: "Name must only contain alphanumeric characters and spaces",
        valid: /^[a-zA-Z0-9 ]+$/.test(name),
        },
    ];

    const passRules = [
        { label: "At least 8 characters", valid: password.length >= 8 },
        { label: "At most 64 characters", valid: password.length <= 64 },
        {
        label: "Contains at least 1 lowercase letter",
        valid: /[a-z]/.test(password),
        },
        {
        label: "Contains at least 1 uppercase letter",
        valid: /[A-Z]/.test(password),
        },
        { label: "Contains at least 1 number", valid: /\d/.test(password) },
        {
        label: "Contains at least 1 accepted symbol",
        valid: /[!@#$%^&*]/.test(password),
        },
    ];

    const confirmPassRules = [
        {
        label: "Confirm Password must match Password",
        valid: confirmPassword === password,
        },
    ];

    const emailRules = [
        { label: "Contains exactly one @ symbol", valid: emailParts.length === 2 },
        { label: "Starts with local-part", valid: localPart.length > 0 },
        { label: "Ends with domain-part", valid: domainPart.length > 0 },
        {
        label: "Local-part is at most 64 characters",
        valid: localPart.length > 0 && localPart.length < 65,
        },
        {
        label: "Local-part does not start or end with .",
        valid:
            localPart.length > 0 &&
            !localPart.startsWith(".") &&
            !localPart.endsWith("."),
        },
        {
        label: "Domain-part is at most 255 characters",
        valid: domainPart.length > 0 && domainPart.length < 256,
        },
        {
        label: "Domain-part must end with a valid extension",
        valid: validExtensions.some((ext) => domainPart.endsWith(ext)),
        },
    ];

    const isNameValid = nameRules.every((rule) => rule.valid);
    const isEmailValid = emailRules.every((rule) => rule.valid);
    const isPasswordValid = passRules.every((rule) => rule.valid);
    const isConfirmPasswordValid = confirmPassRules.every((rule) => rule.valid);
    const isPasswordFormValid = isPasswordValid && isConfirmPasswordValid;

    useEffect(() => {
        const controller = new AbortController();

        async function loadProfile() {
            try {
                const response = await fetch("/api/profile", {
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
                setForm({ name: data.user.name || "", email: data.user.email || "" });
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

    function updateForm(event) {
        setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
        setErrorMessage("");
        setSuccessMessage("");
    }

    async function saveProfile(event) {
        event.preventDefault();
        if (!isNameValid || !isEmailValid) return;
        setIsSaving(true);
        setErrorMessage("");
        setSuccessMessage("");

        try {
            const response = await fetch("/api/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(form),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || "Unable to save profile");
            }

            setUser(data.user);
            setForm({ name: data.user.name, email: data.user.email });
            setIsEditingProfile(false);
            setSuccessMessage("Profile saved.");
        } catch (error) {
            setErrorMessage(error.message || "Unable to save profile");
        } finally {
            setIsSaving(false);
        }
    }

    async function changePassword(event) {
        event.preventDefault();
        if (!isPasswordFormValid) return;
        setIsSubmittingPassword(true);
        setErrorMessage("");
        setSuccessMessage("");

        try {
            const { confirmNewPassword, ...passwordPayload } = passwordForm;
            const response = await fetch("/api/profile/password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(passwordPayload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || "Unable to change password");
            }

            setPasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmNewPassword(false);
            setIsChangingPasswordOpen(false);
            setSuccessMessage("Password changed successfully");
        } catch (error) {
            setErrorMessage(error.message || "Unable to change password");
        } finally {
            setIsSubmittingPassword(false);
        }
    }

    async function uploadAvatar(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setIsUpdatingAvatar(true);
        setErrorMessage("");
        setSuccessMessage("");

        try {
            const avatar = await normalizeAvatar(file);
            const response = await fetch("/api/profile/avatar", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(avatar),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || "Unable to save profile picture.");
            }
            const refreshed = await fetch("/api/profile", { credentials: "include" });
            const refreshedData = await refreshed.json().catch(() => ({}));
            if (!refreshed.ok || !refreshedData.user) {
                throw new Error(refreshedData.message || "Unable to refresh profile.");
            }

            setUser(refreshedData.user);
            window.dispatchEvent(new CustomEvent("dockvision:profile-updated", { detail: refreshedData.user }));
            setSuccessMessage("Profile picture updated.");
        } catch (error) {
            setErrorMessage(error.message || "Unable to save profile picture.");
        } finally {
            setIsUpdatingAvatar(false);
        }
    }

    async function removeAvatar() {
        setIsUpdatingAvatar(true);
        setErrorMessage("");
        setSuccessMessage("");
        try {
            const response = await fetch("/api/profile/avatar", { method: "DELETE", credentials: "include" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || "Unable to remove profile picture.");
            }
            const updatedUser = { ...user, has_avatar: false, avatar_updated_at: null };

            setUser(updatedUser);
            window.dispatchEvent(new CustomEvent("dockvision:profile-updated", { detail: updatedUser }));
            setSuccessMessage("Profile picture removed.");
        } catch (error) {
            setErrorMessage(error.message || "Unable to remove profile picture.");
        } finally {
            setIsUpdatingAvatar(false);
        }
    }

    function cancelPasswordChange() {
        setPasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        setShowConfirmNewPassword(false);
        setIsChangingPasswordOpen(false);
        setErrorMessage("");
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

                {successMessage && <p className="profile-status profile-success" role="status">{successMessage}</p>}

                {user && (
                    <>
                    <section className="profile-card" aria-labelledby="profile-card-title">
                        <h2 id="profile-card-title">About You</h2>
                        <div className="profile-avatar-panel">
                            {user.has_avatar ? (
                                <img className="profile-avatar" src={avatarUrl(user)} alt="Your profile"/>
                            ) : (
                                <div className="profile-avatar profile-avatar-fallback" aria-label="No profile picture">
                                    {user.name?.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div className="profile-avatar-controls">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUpdatingAvatar}
                                >
                                    {isUpdatingAvatar ? "Updating..." : "Upload profile picture"}
                                </button>
                                <input
                                    ref={fileInputRef}
                                    className="profile-file-input"
                                    type="file"
                                    accept="image/png,image/jpeg"
                                    onChange={uploadAvatar}
                                />
                                {user.has_avatar && (
                                    <button
                                        type="button"
                                        onClick={removeAvatar}
                                        disabled={isUpdatingAvatar}
                                    >
                                        Remove picture
                                    </button>
                                )}
                                <p>Images are cropped to a square before saving.</p>
                            </div>
                        </div>
                        {isEditingProfile ? (
                            <form onSubmit={saveProfile}>
                                <dl className="profile-details">
                                    <div>
                                        <dt>Name</dt>
                                        <dd>
                                            <input className="profile-value-box" name="name" value={form.name} onChange={updateForm} required/>
                                            {name.length > 0 && !isNameValid && (
                                                <div className="error-text">
                                                    {nameRules
                                                        .filter((rule) => !rule.valid)
                                                        .map((rule, index) => (
                                                            <p key={index}>{rule.label}</p>
                                                        ))}
                                                </div>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Email</dt>
                                        <dd>
                                            <input className="profile-value-box" name="email" type="email" value={form.email} onChange={updateForm} required/>
                                            {email.length > 0 && !isEmailValid && (
                                                <div className="error-text">
                                                    <p>Error: Invalid Email</p>
                                                </div>
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Account created</dt>
                                        <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
                                    </div>
                                </dl>
                                <div className="profile-actions">
                                    <button
                                        type="submit"
                                        disabled={isSaving || !isNameValid || !isEmailValid}
                                        style={{
                                            opacity: isSaving || !isNameValid || !isEmailValid ? 0.5 : 1,
                                            cursor:
                                            isSaving || !isNameValid || !isEmailValid
                                                ? "not-allowed"
                                                : "pointer",
                                        }}
                                    >
                                            {isSaving ? "Saving..." : "Save changes"}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <>
                                <dl className="profile-details">
                                    <div>
                                        <dt>Name</dt>
                                        <dd>{user.name}</dd>
                                    </div>
                                    <div>
                                        <dt>Email</dt>
                                        <dd>{user.email}</dd>
                                    </div>
                                    <div>
                                        <dt>Account created</dt>
                                        <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
                                    </div>
                                </dl>
                                {isChangingPasswordOpen ? (
                                    <div className="profile-actions">
                                        <button type="button" onClick={() => { setIsEditingProfile(true); setIsChangingPasswordOpen(false); }}>
                                            Edit profile
                                        </button>
                                    </div>
                                ) : (
                                    <div className="profile-actions">
                                        <button type="button" onClick={() => { setIsEditingProfile(true); setIsChangingPasswordOpen(false); }}>
                                            Edit profile
                                        </button>
                                        <button type="button" onClick={() => setIsChangingPasswordOpen((previous) => !previous)}>
                                            Change password
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                    {isChangingPasswordOpen && (
                        <section className="profile-password-card" aria-labelledby="password-title">
                            <h2 id="password-title">Change password</h2>
                            <form onSubmit={changePassword} className="change-password-form">
                                <label>
                                    Current password
                                    <div className="profile-password-input-wrapper">
                                        <input
                                            className="profile-password-box"
                                            type={showCurrentPassword ? "text" : "password"}
                                            value={passwordForm.currentPassword}
                                            onChange={(event) => setPasswordForm((previous) => ({ ...previous, currentPassword: event.target.value }))}
                                            placeholder="Current Password"
                                            autoComplete="current-password"
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="eye-button"
                                            onClick={() => setShowCurrentPassword((previous) => !previous)}
                                        >
                                            {showCurrentPassword ? <FiEyeOff /> : <FiEye />}
                                        </button>
                                    </div>
                                </label>
                                <label>
                                    New password
                                    <div className="profile-password-input-wrapper">
                                        <input
                                            className="profile-password-box"
                                            type={showNewPassword ? "text" : "password"}
                                            value={passwordForm.newPassword}
                                            onChange={(event) => setPasswordForm((previous) => ({ ...previous, newPassword: event.target.value }))}
                                            placeholder="New Password"
                                            autoComplete="new-password"
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="eye-button"
                                            onClick={() => setShowNewPassword((previous) => !previous)}
                                        >
                                            {showNewPassword ? <FiEyeOff /> : <FiEye />}
                                        </button>
                                    </div>
                                </label>
                                <div className="password-strength-checker">
                                    {password.length > 0 && (
                                        <>
                                            <div className="password-strength-bar-track">
                                                {[1, 2, 3, 4].map((seg) => {
                                                    const filledCount = (
                                                        pwScore <= 2 ? 1 :
                                                        pwScore <= 3 ? 2 :
                                                        pwScore <= 4 ? 3 : 4
                                                    );
                                                    const color = (
                                                        pwScore <= 2 ? '#E24B4A' :
                                                        pwScore <= 3 ? '#EF9F27' :
                                                        pwScore <= 4 ? '#639922' :
                                                                       '#1D9E75'
                                                    );
                                                    return (
                                                        <div
                                                            key={seg}
                                                            className="password-strength-bar-segment"
                                                            style={{ background: filledCount >= seg ? color : '#e0e0e0' }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                            <div className="password-strength-label-row">
                                                <span className="password-strength-label" style={{ color: pwLevel.color }}>
                                                    {pwLevel.label}
                                                </span>
                                                <span className="password-strength-score">{pwScore}/6</span>
                                            </div>
                                            <div className="password-strength-rules">
                                                {[
                                                    { label: '8+ characters',                     pass: pwChecks.length     },
                                                    { label: 'Uppercase letter',                   pass: pwChecks.uppercase  },
                                                    { label: 'Lowercase letter',                   pass: pwChecks.lowercase  },
                                                    { label: 'Number',                             pass: pwChecks.number     },
                                                    { label: 'Special character',                  pass: pwChecks.symbol     },
                                                    { label: '12+ characters for strong password', pass: pwChecks.longEnough },
                                                ].map((r, i) => (
                                                <div key={i} className={`password-strength-rule ${r.pass ? 'pass' : ''}`}>
                                                    <span className="password-strength-rule-dot" />
                                                    {r.label}
                                                </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                                {password.length > 0 && !isPasswordValid && (
                                    <div className="error-text">
                                        {passRules
                                        .filter((rule) => !rule.valid)
                                        .map((rule, index) => (
                                            <p key={index}>{rule.label}</p>
                                        ))}
                                    </div>
                                )}
                                <label>
                                    Confirm new password
                                    <div className="profile-password-input-wrapper">
                                        <input
                                            className="profile-password-box"
                                            type={showConfirmNewPassword ? "text" : "password"}
                                            value={passwordForm.confirmNewPassword}
                                            onChange={(event) => setPasswordForm((previous) => ({ ...previous, confirmNewPassword: event.target.value }))}
                                            placeholder="Confirm New Password"
                                            autoComplete="new-password"
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="eye-button"
                                            onClick={() => setShowConfirmNewPassword((previous) => !previous)}
                                        >
                                            {showConfirmNewPassword ? <FiEyeOff /> : <FiEye />}
                                        </button>
                                    </div>
                                </label>
                                {confirmPassword.length > 0 && !isConfirmPasswordValid && (
                                    <div className="error-text">
                                        {confirmPassRules
                                        .filter((rule) => !rule.valid)
                                        .map((rule, index) => (
                                            <p key={index}>{rule.label}</p>
                                        ))}
                                    </div>
                                )}
                                <div className="profile-actions">
                                    <button
                                        type="submit"
                                        disabled={isSubmittingPassword || !isPasswordFormValid}
                                        style={{
                                            opacity: isSubmittingPassword || !isPasswordFormValid ? 0.5 : 1,
                                            cursor:
                                            isSubmittingPassword || !isPasswordFormValid
                                                ? "not-allowed"
                                                : "pointer",
                                        }}
                                    >
                                        {isSubmittingPassword ? "Saving password..." : "Save password"}
                                    </button>
                                    <button type="button" onClick={cancelPasswordChange} disabled={isSubmittingPassword}>
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </section>
                    )}
                    <ProfileRunHistory />
                    </>
                )}
            </main>
        </>
    );
}
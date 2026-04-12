import React, { useState } from "react";
import "./Auth.css";
import "../Login.css";
import Navigation from "../components/Navigation";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

export default function Login({ onSubmit, errorMessage, isLocked }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [clientError, setClientError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (clientError) {
      setClientError("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setClientError("");

    const cleanedEmail = formData.email.trim().toLowerCase();

    if (cleanedEmail.length > 254 || !isValidEmail(cleanedEmail)) {
      setClientError(
        "Email must be valid and end in .com, .gov, .edu, .net, or .org"
      );
      return;
    }

    if (!onSubmit) {
      return;
    }

    await onSubmit({
      email: cleanedEmail,
      password: formData.password,
    });
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-logo">DockVision</div>
        <Navigation />
      </header>

      <main className="auth-main login-main">
        <section className="auth-card login-card">
          <h1 className="auth-title">Sign In</h1>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label" htmlFor="email">
              Email
            </label>
            <input
              className="auth-input"
              id="email"
              name="email"
              type="email"
              placeholder="Value"
              value={formData.email}
              onChange={handleChange}
              maxLength={254}
              required
            />

            <label className="auth-label" htmlFor="password">
              Password
            </label>
            <input
              className="auth-input"
              id="password"
              name="password"
              type="password"
              placeholder="Value"
              value={formData.password}
              onChange={handleChange}
              maxLength={128}
              required
            />

            <button
              className="auth-submit-btn"
              type="submit"
              disabled={isLocked}
            >
              Sign In
            </button>
          </form>

          <a className="auth-link" href="/forgot-password">
            Forgot password?
          </a>
        </section>
      </main>

      <div className="toast-stack">
        {isLocked && (
          <div className="toast">
            <div className="toast-title">Multiple Sign In attempts</div>
            <div className="toast-message">
              Too many attempts, try again later
            </div>
          </div>
        )}

        {(clientError || errorMessage) && (
          <div className="toast">
            <div className="toast-title">Incorrect Credentials</div>
            <div className="toast-message">{clientError || errorMessage}</div>
          </div>
        )}
      </div>
    </div>
  );
}
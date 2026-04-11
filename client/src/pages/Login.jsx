import React, { useState } from "react";
import "./Auth.css";
import "../Login.css";

export default function Login({ onSubmit, errorMessage, isLocked }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (onSubmit) {
      await onSubmit(formData);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-logo">DockVision</div>

        <nav className="auth-nav">
          <a className="nav-btn" href="/about">About</a>
          <a className="nav-btn" href="/contact">Contact</a>
          <a className="nav-btn active" href="/login">Sign In</a>
          <a className="nav-btn" href="/register">Register</a>
        </nav>
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

        {errorMessage && (
          <div className="toast">
            <div className="toast-title">Incorrect Credentials</div>
            <div className="toast-message">{errorMessage}</div>
          </div>
        )}
      </div>
    </div>
  );
}
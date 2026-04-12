import React, { useState } from "react";
import "./Auth.css";
import "../Register.css";

export default function Registration({ onSubmit, errorMessage, isSubmitting }) {
  const [formData, setFormData] = useState({
    name: "",
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


  console.log("FORM SUBMITTED"); // ADD THIS

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
          <a className="nav-btn" href="/login">Sign In</a>
          <a className="nav-btn active" href="/register">Register</a>
        </nav>
      </header>

      <main className="auth-main register-main">
        <div className="register-wrapper">
          <h1 className="auth-title register-title">Register</h1>

          <section className="auth-card">
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-label" htmlFor="name">
                Name
              </label>
              <input
                className="auth-input"
                id="name"
                name="name"
                type="text"
                placeholder="Jane Doe"
                value={formData.name}
                onChange={handleChange}
                required
              />

              <label className="auth-label" htmlFor="email">
                Email
              </label>
              <input
                className="auth-input"
                id="email"
                name="email"
                type="email"
                placeholder="janedoe@example.com"
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
                placeholder="password123"
                value={formData.password}
                onChange={handleChange}
                required
              />

              <button
                className="auth-submit-btn"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating Account..." : "Register"}
              </button>
            </form>
          </section>

          <div className="register-footer">
            Already have an account? <a href="/login">Log in</a>
          </div>
        </div>
      </main>

      <div className="toast-stack">
        {errorMessage && (
          <div className="toast">
            <div className="toast-title">Registration Error</div>
            <div className="toast-message">{errorMessage}</div>
          </div>
        )}
      </div>
    </div>
  );
}
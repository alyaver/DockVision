import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Auth.css";
import "../Register.css";
import Navigation from "../components/Navigation";
import { registerUser } from "../services/AuthServices.js";

function isValidName(value) {
  return /^[A-Za-z][A-Za-z\s'-]{1,29}$/.test(value);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,128}$/.test(
    value
  );
}

/**
 * Registration page.
 *
 * Cleanup decision:
 * - Keep the stronger validation rules already present in main.
 * - Make this page self-contained instead of expecting a missing wrapper/container.
 */
export default function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [clientError, setClientError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (clientError) setClientError("");
    if (serverError) setServerError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setClientError("");
    setServerError("");

    const cleanedName = formData.name.trim().replace(/\s+/g, " ");
    const cleanedEmail = formData.email.trim().toLowerCase();
    const password = formData.password;
    const confirmPassword = formData.confirmPassword;

    if (!cleanedName) {
      setClientError("Name is required");
      return;
    }

    if (!isValidName(cleanedName)) {
      setClientError(
        "Name must be 2 to 30 characters and contain only letters, spaces, apostrophes, or hyphens"
      );
      return;
    }

    if (cleanedEmail.length > 254 || !isValidEmail(cleanedEmail)) {
      setClientError(
        "Email must be valid and end in .com, .gov, .edu, .net, or .org"
      );
      return;
    }

    if (!isStrongPassword(password)) {
      setClientError(
        "Password must be at least 10 characters and include uppercase, lowercase, number, and symbol"
      );
      return;
    }

    if (password !== confirmPassword) {
      setClientError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);

    try {
      await registerUser({
        name: cleanedName,
        email: cleanedEmail,
        password,
        confirmPassword,
      });

      // Backend creates the session on successful registration.
      navigate("/dashboard");
    } catch (error) {
      setServerError(error.message || "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-logo">DockVision</div>
        <Navigation />
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
                maxLength={30}
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
                placeholder="password123!"
                value={formData.password}
                onChange={handleChange}
                minLength={10}
                maxLength={128}
                required
              />

              <label className="auth-label" htmlFor="confirmPassword">
                Confirm Password
              </label>
              <input
                className="auth-input"
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={formData.confirmPassword}
                onChange={handleChange}
                minLength={10}
                maxLength={128}
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
            Already have an account? <a href="/sign-in">Log in</a>
          </div>
        </div>
      </main>

      <div className="toast-stack">
        {(clientError || serverError) && (
          <div className="toast">
            <div className="toast-title">Registration Error</div>
            <div className="toast-message">{clientError || serverError}</div>
          </div>
        )}
      </div>
    </div>
  );
}
import React, { useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import "./Auth.css";
import "../Login.css";
import Navigation from "../components/Navigation";
import { useLocation } from "react-router-dom";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

export default function Login({ onSubmit, errorMessage, isLocked }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [clientError, setClientError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const location = useLocation();
  const registerMessage = location.state?.message || "";

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

    if (cleanedEmail.length > 127 || !isValidEmail(cleanedEmail)) {
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
    <>
      <Navigation />
    
      <main className="login-page">
        <section className="login-hero">
          <h1 className="login-heading">Sign In</h1>

          <form onSubmit={handleSubmit}>
            <div className="login-info-fields">
              <h2 className="value-text" htmlFor="email">
                Email
              </h2>
              <input
                className="login-value-box"
                id="email"
                name="email"
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
                maxLength={128}
                required
              />

              <h2 className="value-text" htmlFor="password">
                Password
              </h2>
              <div className="password-input-wrapper">
                <input
                  className="login-password-box"
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"} 
                  value={formData.password}
                  onChange={handleChange}
                  maxLength={64}
                  placeholder="Password"
                  required
                />

                <button type="button" className="eye-button" onClick={() => setShowPassword(prev => !prev)}>
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>

              <button
                className="login-button"
                type="submit"
                disabled={isLocked}
              >
                Sign In
              </button>

            </div>
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

        {(registerMessage) && (
          <div className="toast">
            <div className="toast-title">Registration Successful</div>
            <div className="toast-message">{registerMessage}</div>
          </div>
        )}
      </div>
    </>
  );
}
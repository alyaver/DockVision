import { Link } from "react-router-dom";
import { useState } from "react";
import Navigation from "../components/Navigation";
import "../Registration.css";
import "../NavBar.css";

export default function Registration({
  onSubmit,
  errorMessage = "",
  isSubmitting = false,
}) {
  // Local UI state for each field.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm_password, setConfirmPassword] = useState("");
  const validExtensions = [".com", ".org", ".net", ".gov", ".edu", ".mil"];

  // Basic email splitting for validation rules.
  const emailParts = email.split("@");
  const localPart = emailParts.length === 2 ? emailParts[0] : "";
  const domainPart = emailParts.length === 2 ? emailParts[1] : "";

  const nameRules = [
    {
      label: "Name must be 6 to 30 characters",
      valid: name.length >= 6 && name.length <= 30,
    },
    {
      label: "Name must only contain alphanumeric characters and spaces",
      valid: /^[a-zA-Z0-9 ]+$/.test(name),
    },
  ];

  const passRules = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Contains at least 1 number", valid: /\d/.test(password) },
    { label: "Contains at least 1 letter", valid: /[a-zA-Z]/.test(password) },
  ];

  const confirmPassRules = [
    {
      label: "Confirm Password must match Password",
      valid: confirm_password === password,
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

  // The form can only submit once every rule passes and no request is in flight.
  const isRegistrationValid =
    isNameValid &&
    isEmailValid &&
    isPasswordValid &&
    isConfirmPasswordValid;

  function handleSubmit(event) {
    // Prevent the browser from doing a full page refresh on form submit.
    event.preventDefault();

    // Guard against invalid submits and double clicks while the request is active.
    if (!isRegistrationValid || isSubmitting) {
      return;
    }

    // Normalize values before they leave the UI layer.
    // This reduces backend cleanup and avoids duplicate accounts due to casing/spaces.
    const formData = {
      name: name.trim().replace(/\s+/g, " "),
      email: email.trim().toLowerCase(),
      password,
      // Use the original payload key expected by the earlier working implementation.
      confirmPassword: confirm_password,
    };

    // Delegate the actual API/database work to the container.
    onSubmit?.(formData);
  }

  return (
    <>
      <Navigation />
      <main className="register-page">
        <section className="register-hero">
          <h1 className="register-heading">Register</h1>

          {/*
            Use a real form so Enter key submission works and accessibility stays intact.
            The container still controls what happens after successful registration.
          */}
          <form className="register-info-fields" onSubmit={handleSubmit}>
            <h2 className="value-text">Name</h2>
            <input
              className="register-value-box"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="name"
            />

            {name.length > 0 && !isNameValid && (
              <div className="error-text">
                {nameRules
                  .filter((rule) => !rule.valid)
                  .map((rule, index) => (
                    <p key={index}>{rule.label}</p>
                  ))}
              </div>
            )}

            <h2 className="value-text">Email</h2>
            <input
              className="register-value-box"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
            />

            {email.length > 0 && !isEmailValid && (
              <div className="error-text">
                <p>Error: Invalid Email</p>
              </div>
            )}

            <h2 className="value-text">Password</h2>
            <input
              className="register-value-box"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="new-password"
            />

            {password.length > 0 && !isPasswordValid && (
              <div className="error-text">
                {passRules
                  .filter((rule) => !rule.valid)
                  .map((rule, index) => (
                    <p key={index}>{rule.label}</p>
                  ))}
              </div>
            )}

            <h2 className="value-text">Confirm Password</h2>
            <input
              className="register-value-box"
              type="password"
              value={confirm_password}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm Password"
              autoComplete="new-password"
            />

            {confirm_password.length > 0 && !isConfirmPasswordValid && (
              <div className="error-text">
                {confirmPassRules
                  .filter((rule) => !rule.valid)
                  .map((rule, index) => (
                    <p key={index}>{rule.label}</p>
                  ))}
              </div>
            )}

            {/*
              Show backend/API errors from the container here.
              Example: duplicate email, failed registration, server validation error.
            */}
            {errorMessage && (
              <div className="error-text">
                <p>{errorMessage}</p>
              </div>
            )}

            <button
              className="register-button"
              type="submit"
              disabled={!isRegistrationValid || isSubmitting}
              style={{
                opacity: !isRegistrationValid || isSubmitting ? 0.5 : 1,
                cursor:
                  !isRegistrationValid || isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Creating Account..." : "Create Account"}
            </button>

            <Link to="/forgot-password" className="register-secondary-link">
              Forgot Password
            </Link>
            <Link to="/sign-in" className="register-secondary-link">
              Sign In
            </Link>
          </form>
        </section>
      </main>
    </>
  );
}

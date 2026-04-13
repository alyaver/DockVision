import { Link } from "react-router-dom";
import { useState } from "react";
import Navigation from "../components/Navigation";
import { loginUser } from "../services/AuthServices.js";
import "../SignIn.css";
import "../NavBar.css";

/**
 * SignIn page only.
 * Do not mix Register-page logic into this file.
 */
const SignIn = () => {
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validExtensions = [".com", ".org", ".net", ".gov", ".edu", ".mil"];

  const emailParts = email.split("@");
  const localPart = emailParts.length === 2 ? emailParts[0] : "";
  const domainPart = emailParts.length === 2 ? emailParts[1] : "";

  const passRules = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "Contains a number", valid: /\d/.test(password) },
    { label: "Has an uppercase letter", valid: /[A-Z]/.test(password) },
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

  const isPasswordValid = passRules.every((rule) => rule.valid);
  const isEmailValid = emailRules.every((rule) => rule.valid);
  const isEmpty = email.trim() === "" || password === "";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError("");

    if (!isEmailValid || !isPasswordValid) return;

    setIsSubmitting(true);

    try {
      await loginUser({
        email: email.trim().toLowerCase(),
        password,
      });

      window.location.href = "/dashboard";
    } catch (error) {
      setServerError(error.message || "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Navigation />

      <main className="sign-in-page">
        <section className="sign-in-hero">
          <h1 className="sign-in-heading">Sign In</h1>

          <form onSubmit={handleSubmit}>
            <div className="sign-in-info-fields">
              <h2 className="value-text">Email</h2>
              <input
                className="sign-in-value-box"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter an Email"
              />
              {submitted && !isEmailValid && (
                <p className="error">Invalid email format</p>
              )}

              <h2 className="value-text">Password</h2>
              <input
                className="sign-in-value-box"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Password"
              />
              {submitted && !isPasswordValid && (
                <p className="error">Invalid password format</p>
              )}

              {serverError && <p className="error">{serverError}</p>}

              <button
                className="sign-in-button"
                type="submit"
                disabled={isEmpty || isSubmitting}
                style={{
                  opacity: isEmpty || isSubmitting ? 0.5 : 1,
                  cursor: isEmpty || isSubmitting ? "not-allowed" : "pointer",
                }}
              >
                {isSubmitting ? "Signing In..." : "Sign In"}
              </button>

              <Link to="/forgot-password" className="sign-in-secondary-link">
                Forgot Password
              </Link>

              <Link to="/registration" className="sign-in-secondary-link">
                Create Account
              </Link>
            </div>
          </form>
        </section>
      </main>
    </>
  );
};

export default SignIn;
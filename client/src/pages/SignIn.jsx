import { Link } from "react-router-dom";
import { useState } from "react";
import Navigation from "../components/Navigation";
import "../SignIn.css";
import "../NavBar.css";

/**
 * SignIn page
 *
 * Merge repair decision:
 * - Keep this file as a SignIn page only.
 * - Do not keep any Register-page code in this file.
 * - Keep the teammate's client-side validation idea, but restore valid JSX.
 */
const SignIn = () => {
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Allowed email endings from the incoming sign-in validation branch.
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

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);

    // For this merge repair, stop on client-side validation failure.
    // Backend login wiring can be added after the merge is stable again.
    if (!isEmailValid || !isPasswordValid) return;

    console.log("Sign-in form passed client validation.");
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

              <button
                className="sign-in-button"
                type="submit"
                disabled={isEmpty}
                style={{
                  opacity: isEmpty ? 0.5 : 1,
                  cursor: isEmpty ? "not-allowed" : "pointer",
                }}
              >
                Sign In
              </button>

              <Link to="/forgot-password" className="sign-in-secondary-link">
                Forgot Password
              </Link>

              <Link to="/register" className="sign-in-secondary-link">
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
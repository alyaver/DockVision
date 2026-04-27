import { Link, useNavigate } from "react-router-dom";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { useState } from "react";
import Navigation from "../components/Navigation";
import "../Registration.css";
import "../NavBar.css";


function getPasswordStrength(password) {
  const checks = {
    length:     password.length >= 8,
    longEnough: password.length >= 12,
    uppercase:  /[A-Z]/.test(password),
    lowercase:  /[a-z]/.test(password),
    number:     /\d/.test(password),
    symbol:     /[^A-Za-z0-9]/.test(password),
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [notifications, setNotifications] = useState([]);

const { checks: pwChecks, score: pwScore, level: pwLevel } = getPasswordStrength(password);

  const navigate = useNavigate();

  const validExtensions = [".com", ".org", ".net", ".gov", ".edu", ".mil"];

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
      label: "Contains at least 1 symbol",
      valid: /[^A-Za-z\d]/.test(password),
    },
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
    isNameValid && isEmailValid && isPasswordValid && isConfirmPasswordValid;

  // show notifications to user
  function pushNotification(type, title, msg) {
    const id = crypto.randomUUID();
    setNotifications((current) => [...current, { id, type, title, msg }]);
  }

  // allow users to dismiss notifications
  function dismissNotification(id) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

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
    onSubmit?.(formData)
      .then(() => {
        pushNotification( // show success message on successful registration
          "success",
          "Registration Successful",
          "Your account has been created.",
        );
      })
      .catch((error) => {
        if (error.status === 409) { // show specific message for duplicate email error
          pushNotification(
            "error",
            "Registration Failed",
            "Email already in use, select a different email or sign in to your existing account.",
          );
        } else {
          pushNotification( // show generic error message for other types of errors
            "error",
            "Registration Failed",
            "An unexpected error occurred. Please try again later.",
          );
        }
      });
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
              disabled={isSubmitting}
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
              disabled={isSubmitting}
            />

            {email.length > 0 && !isEmailValid && (
              <div className="error-text">
                <p>Error: Invalid Email</p>
              </div>
            )}

            <h2 className="value-text">Password</h2>
            <div className="password-input-wrapper">
              <input
                className="register-password-box"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="new-password"
                disabled={isSubmitting}
              />

              <button
                type="button"
                className="eye-button"
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={isSubmitting}
              >
                {showPassword ? <FiEyeOff /> : <FiEye />}
              </button>
            </div>

           <div className="password-strength-checker">
              {password.length > 0 && (
                <>
                  <div className="strength-bar-track">
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
                          className="strength-bar-segment"
                          style={{ background: filledCount >= seg ? color : '#e0e0e0' }}
                        />
                      );
                    })}
                  </div>

                  <div className="strength-label-row">
                    <span className="strength-label" style={{ color: pwLevel.color }}>
                      {pwLevel.label}
                    </span>
                    <span className="strength-score">{pwScore}/6</span>
                  </div>

                  <div className="strength-rules">
                    {[
                      { label: '8+ characters',                     pass: pwChecks.length     },
                      { label: 'Uppercase letter',                   pass: pwChecks.uppercase  },
                      { label: 'Lowercase letter',                   pass: pwChecks.lowercase  },
                      { label: 'Number',                             pass: pwChecks.number     },
                      { label: 'Special character',                  pass: pwChecks.symbol     },
                      { label: '12+ characters for strong password', pass: pwChecks.longEnough },
                    ].map((r, i) => (
                      <div key={i} className={`strength-rule ${r.pass ? 'pass' : ''}`}>
                        <span className="strength-rule-dot" />
                        {r.label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {password.length > 0 && !isPasswordValid && (
              <div className="error-text">
                {passRules.filter((rule) => !rule.valid).map((rule, index) => (
                  <p key={index}>{rule.label}</p>
                ))}
              </div>
            )}

            <h2 className="value-text">Confirm Password</h2>
            <div className="password-input-wrapper">
              <input
                className="register-password-box"
                type={showConfirmPassword ? "text" : "password"}
                value={confirm_password}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm Password"
                autoComplete="new-password"
                disabled={isSubmitting}
              />

              <button
                type="button"
                className="eye-button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                disabled={isSubmitting}
              >
                {showConfirmPassword ? <FiEyeOff /> : <FiEye />}
              </button>
            </div>

            {confirm_password.length > 0 && !isConfirmPasswordValid && (
              <div className="error-text">
                {confirmPassRules
                  .filter((rule) => !rule.valid)
                  .map((rule, index) => (
                    <p key={index}>{rule.label}</p>
                  ))}
              </div>
            )}

            {errorMessage && (
              <div
                className="registration-error-banner"
                role="alert"
                aria-live="polite"
              >
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
                  !isRegistrationValid || isSubmitting
                    ? "not-allowed"
                    : "pointer",
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

          <div className="Notify-stack">
            {notifications.map((item) => (
              <div key={item.id} className="Notify">
                <div className={`Notify-icon ${item.type}`}>
                  {item.type === "error" ? "✕" : "!"}
                </div>
                <div className="Notify-content">
                  <div className="Notify-title">{item.title}</div>
                  <div className="Notify-msg">{item.msg}</div>
                </div>
                <button
                  className="Notify-close"
                  onClick={() => dismissNotification(item.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

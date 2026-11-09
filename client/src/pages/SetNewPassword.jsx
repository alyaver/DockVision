/**
 * Reset-password completion page.
 *
 * This page validates the reset token from the URL, submits the replacement
 * password through the main backend, and keeps the browser talking to the same
 * proxied /api/auth routes used elsewhere in the app.
 */
import Navigation from '../components/Navigation';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import {
  getPasswordRules,
  getPasswordStrength,
  getStrengthBarPresentation,
} from '../lib/passwordStrength.mjs';
import '../SetNewPassword.css';
import '../NavBar.css';

//renders token validation, password-strength guidance, and reset completion for one emailed reset link.
const SetNewPassword = () => {
  const [isValid, setIsValid] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  //derives all visible strength feedback from the same shared rules used by registration.
  const { checks: passwordChecks, score: passwordScore, level: passwordLevel } = getPasswordStrength(newPassword);
  const passwordRules = getPasswordRules(newPassword);
  const isPasswordValid = passwordRules.every((rule) => rule.valid);
  const isConfirmationValid = confirmPassword === newPassword;
  const strengthBar = getStrengthBarPresentation(passwordScore);

  //validates the URL token before exposing the form so expired or consumed links cannot be submitted.
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      setIsValid(false);
      setError('No token provided in URL');
      return;
    }

    //asks the backend because token validity depends on server-side expiry and consumption state.
    fetch(`/api/auth/reset/validate?token=${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setIsValid(true);
        } else {
          setIsValid(false);
          setError(data.message || 'Invalid token');
        }
      })
      .catch(err => {
        setIsValid(false);
        setError('Failed to validate token');
      });
  }, []);

  //submits a confirmed, locally valid replacement password to the server-owned reset flow.
  const handleSetPassword = async () => {
    setError('');

    //stops mismatched values before a reset request can be made.
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    //keeps browser feedback immediate while the server remains the authoritative password validator.
    if (!isPasswordValid) {
      setError('Please meet all password requirements.');
      return;
    }

    //reads the original link token only when a valid form is ready for submission.
    const token = new URLSearchParams(window.location.search).get('token');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.message || 'Reset failed. Please try again.');
        return;
      }

      navigate('/Login');

    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isValid === null) {
    return (
      <>
        <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <div className="loading">Validating token...</div>
          </section>
        </main>
      </>
    );
  }

  if (!isValid) {
    return (
      <>
        <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <h1 className="set-new-password-heading">Invalid Reset Link</h1>
            <div className="error-panel">
              <p>{error}</p>
              <Link to="/forgot-password" className="error-link">Back to Forgot Password</Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <h1 className="set-new-password-heading">Set New Password</h1>
            <div className="set-new-password-info-fields">
              <h2 className="value-text">New Password</h2>
              {/*wraps the field so its visibility toggle can sit inside the input without covering typed text.*/}
              <div className="set-new-password-input-wrapper">
                <input
                  className="set-new-password-value-box"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="New Password"
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="set-new-password-eye-button"
                  onClick={() => {
                    //keeps new-password visibility independent from confirmation visibility.
                    setShowNewPassword((previous) => !previous);
                  }}
                  disabled={loading}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                >
                  {showNewPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              {/*renders the same progress segments, score, and requirement list used on registration.*/}
              <div className="set-new-password-strength-checker">
                {newPassword.length > 0 && (
                  <>
                    <div className="set-new-password-strength-bar-track">
                      {[1, 2, 3, 4].map((segment) => (
                        <div
                          key={segment}
                          className="set-new-password-strength-bar-segment"
                          style={{
                            background:
                              strengthBar.filledSegmentCount >= segment
                                ? strengthBar.color
                                : '#e0e0e0',
                          }}
                        />
                      ))}
                    </div>

                    <div className="set-new-password-strength-label-row">
                      <span
                        className="set-new-password-strength-label"
                        style={{ color: passwordLevel.color }}
                      >
                        {passwordLevel.label}
                      </span>
                      <span className="set-new-password-strength-score">{passwordScore}/6</span>
                    </div>

                    <div className="set-new-password-strength-rules">
                      {[
                        { label: '8+ characters', pass: passwordChecks.length },
                        { label: 'Uppercase letter', pass: passwordChecks.uppercase },
                        { label: 'Lowercase letter', pass: passwordChecks.lowercase },
                        { label: 'Number', pass: passwordChecks.number },
                        { label: 'Special character', pass: passwordChecks.symbol },
                        { label: '12+ characters for strong password', pass: passwordChecks.longEnough },
                      ].map((rule) => (
                        <div
                          key={rule.label}
                          className={`set-new-password-strength-rule ${rule.pass ? 'pass' : ''}`}
                        >
                          <span className="set-new-password-strength-rule-dot" />
                          {rule.label}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {newPassword.length > 0 && !isPasswordValid && (
                <div className="set-new-password-error-text" role="alert">
                  {passwordRules
                    .filter((rule) => !rule.valid)
                    .map((rule) => <p key={rule.label}>{rule.label}</p>)}
                </div>
              )}
              <h2 className="value-text">Confirm New Password</h2>
              {/*uses a separate wrapper and state value so confirmation visibility does not expose the first field.*/}
              <div className="set-new-password-input-wrapper">
                <input
                  className="set-new-password-value-box"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Confirm New Password"
                  autoComplete="new-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="set-new-password-eye-button"
                  onClick={() => {
                    //toggles only the confirmation value while preserving the field contents.
                    setShowConfirmPassword((previous) => !previous);
                  }}
                  disabled={loading}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              {confirmPassword.length > 0 && !isConfirmationValid && (
                <div className="set-new-password-error-text" role="alert">
                  <p>Confirm Password must match Password</p>
                </div>
              )}
              {error && <p className="set-new-password-server-error" role="alert">{error}</p>}
               <button className="set-new-password-button" onClick={handleSetPassword} disabled={loading || !newPassword || !confirmPassword || !isPasswordValid || !isConfirmationValid}>
                {loading ? 'Saving...':'Set Password'}
              </button>
            <Link to="/login" className="back-link">Back to Sign In</Link>
            </div>
          </section>
        </main>
    </>
  );
};

export default SetNewPassword;

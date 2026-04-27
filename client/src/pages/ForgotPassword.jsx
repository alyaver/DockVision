import Navigation from "../components/Navigation";
import "../NavBar.css";
import "../ForgotPassword.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Forgot-password page.
 *
 * Cleanup decisions:
 * - Fix reversed success/error logic.
 * - Always turn loading back off.
 * - Use the proxied /api path instead of hardcoded hosts.
 */
const ForgotPassword = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleResetPassword = async () => {
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || "Something went wrong. Try again.");
      }

      setMessage(data.message || "Link sent. Check your email.");
      setIsError(false);
      setSubmitted(true); // show confirmation panel
    } catch (err) {
      setMessage(err.message || "Network error. Try again.");
      setIsError(true);
      setSubmitted(true); // show confirmation panel
    } finally {
      setLoading(false);
    }
  };

  // After successful request, replace forgot password form with this confirmation
  if (submitted) {
    return (
      <>
      <Navigation />
      <main className="forgotPassword">
        <section className="forgotPassword-hero">
          <h1 className="forgotPassword-heading">Reset Password</h1>
            <div className="resetPassword">
              <p>If an account exists with this email, you'll receive a password reset link shortly. Please check your inbox.</p>
              <div className="button-group">
                <button 
                  className="submit-Button"
                  type="button"
                  onClick={() => navigate("/login")}
                  >
                    Back to Sign In
                  </button>
              </div>
            </div>
        </section>
      </main>
    </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="forgotPassword">
        <section className="forgotPassword-hero">
          <h1 className="forgotPassword-heading">Reset Password</h1>

          <div className="resetPassword">
            <div className="email-info">
              <label className="email-label" htmlFor="emailAddress">
                Email
              </label>
              <input
                className="email-box"
                type="email"
                id="emailAddress"
                placeholder="Enter E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {message && (
              <p style={{ color: isError ? "red" : "green" }}>{message}</p>
            )}

            <div className="button-group">
              <button
                className="cancel-Button"
                type="button"
                onClick={() => navigate("/login")} // changed /sign-in to /login
              >
                Cancel
              </button>

              <button
                className="submit-Button"
                type="button"
                onClick={handleResetPassword}
                disabled={loading || !email.trim()}
              >
                {loading ? "Sending..." : "Reset Password"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default ForgotPassword;
import Navigation from "../components/Navigation";
import "../NavBar.css";
import "../ForgotPassword.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Forgot-password request page.
 *
 * Responsibilities:
 * - collect the account email for the reset request
 * - call the backend endpoint that issues the reset token
 * - surface success and failure states without leaking transport details into
 *   the rest of the UI
 */
const ForgotPassword = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

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
    } catch (err) {
      setMessage(err.message || "Network error. Try again.");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

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
                onClick={() => navigate("/sign-in")}
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

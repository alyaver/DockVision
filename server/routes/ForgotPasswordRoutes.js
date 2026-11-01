const express = require("express");
const crypto = require("crypto");

const RESET_REQUEST_WINDOW_MINUTES = 15;
const MAX_UNIQUE_EMAILS_PER_IP = 3;
const MAX_RESET_REQUESTS_PER_EMAIL_PER_IP = 3;
const MAX_EMAIL_LENGTH = 50;
const GENERIC_RESET_MESSAGE = "If that email is registered, a reset link has been sent.";

//accepts the existing account-email domain policy before reset requests reach storage or delivery.
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

//creates the existing reset-request endpoint with injected storage and mail dependencies for isolated verification.
function createForgotPasswordRouter({ db, transporter, mailConfiguration }) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Forgot-password routes require a database query() method.");
  }

  const router = express.Router();

  //processes password-reset requests without exposing account eligibility through the normal acknowledgement.
  router.post("/", async (req, res) => {
    //normalizes before validation and rate limiting so casing and surrounding whitespace cannot bypass request limits.
    const rawEmail = req.body?.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const genericResponse = () => res.status(200).json({ message: GENERIC_RESET_MESSAGE });

    if (!email || email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
      return res.status(400).json({
        message: "Email must be valid and end in .com, .gov, .edu, .net, or .org",
      });
    }

    if (!transporter || !mailConfiguration) {
      return res.status(503).json({ message: "Email service is not configured yet." });
    }

    //uses the forwarded address when available so a reverse proxy does not collapse all clients into one rate-limit bucket.
    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    try {
      const rateLimitResult = await db.query(
        `SELECT COUNT(DISTINCT email)::int AS unique_email_count
         FROM password_reset_request_attempts
         WHERE ip_address = $1
           AND requested_at > CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 minute')`,
        [ipAddress, RESET_REQUEST_WINDOW_MINUTES]
      );
      const uniqueEmailCount = rateLimitResult.rows[0].unique_email_count;

      const repeatedEmailResult = await db.query(
        `SELECT COUNT(*)::int AS request_count
         FROM password_reset_request_attempts
         WHERE ip_address = $1
           AND email = $2
           AND requested_at > CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 minute')`,
        [ipAddress, email, RESET_REQUEST_WINDOW_MINUTES]
      );
      const repeatedEmailCount = repeatedEmailResult.rows[0].request_count;

      //blocks enumeration attempts that rotate addresses while still allowing repeated-address accounting to use its own limit.
      if (uniqueEmailCount >= MAX_UNIQUE_EMAILS_PER_IP && repeatedEmailCount === 0) {
        return res.status(429).json({ message: "Please wait a few minutes before trying again." });
      }

      //caps repeated requests for one address so an attacker cannot repeatedly trigger delivery to the same mailbox.
      if (repeatedEmailCount >= MAX_RESET_REQUESTS_PER_EMAIL_PER_IP) {
        return res.status(429).json({ message: "Please wait a few minutes before trying again." });
      }

      await db.query(
        `INSERT INTO password_reset_request_attempts (email, ip_address)
         VALUES ($1, $2)`,
        [email, ipAddress]
      );

      //limits token issuance to active accounts while preserving the same acknowledgement for unknown or ineligible addresses.
      const result = await db.query(
        "SELECT user_id FROM users WHERE email = $1 AND deletion_status = 'active'",
        [email]
      );

      if (result.rows.length === 0) {
        return genericResponse();
      }

      const userId = result.rows[0].user_id;
      //invalidates older links before creating the replacement so one account has one current reset secret.
      await db.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);

      //stores only a hash while the raw secret remains limited to the outgoing reset link.
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await db.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP)`,
        [userId, tokenHash]
      );

      //uses only the validated server-side origin and never request host data when building the browser reset link.
      const resetLink = `${mailConfiguration.clientUrl}/set-new-password?token=${rawToken}`;
      await transporter.sendMail({
        from: mailConfiguration.user,
        to: email,
        subject: "Password Reset",
        html: `
          <p>Click the link below to reset your password. It expires in 1 hour.</p>
          <a href="${resetLink}">${resetLink}</a>
          <p>If you did not request this, you can safely ignore this email.</p>
        `,
      });

      //returns the same normal-service message only after the transport accepts the delivery request.
      return genericResponse();
    } catch (error) {
      //does not include account, token, mail, or configuration details in a storage or transport failure response.
      console.error("FORGOT PASSWORD SERVER ERROR:", error);
      return res.status(500).json({ message: "Server error. Please try again." });
    }
  });

  return router;
}

module.exports = { createForgotPasswordRouter };
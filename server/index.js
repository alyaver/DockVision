require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { exec } = require("child_process");
const checkDiskSpace = require("check-disk-space").default;
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const db = require("./db/db");
const authRoutes = require("./routes/AuthRoutes");

const app = express();
const PORT = 5000;

/**
 * Single backend policy:
 * - one Express app
 * - one backend entry point
 * - frontend talks to /api through the Vite proxy
 *
 * CORS is still configured for local direct access, but the intended dev flow
 * is the React client calling relative /api URLs through Vite.
 */
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

/**
 * Build the mail transporter only when all required email settings exist.
 *
 * Why:
 * - Forgot-password should not crash the whole backend at startup
 * - Docker/readiness/auth work should still boot even if email is unfinished
 */
function createMailTransporter() {
  const emailHost = process.env.EMAIL_HOST;
  const emailPort = Number(process.env.EMAIL_PORT);
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailHost || !emailPort || !emailUser || !emailPass) {
    console.warn(
      "Email transporter not initialized. Missing one or more EMAIL_* environment variables."
    );
    return null;
  }

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort === 465,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
}

const transporter = createMailTransporter();

/**
 * Health check for the dashboard readiness card.
 */
app.get("/api/health", (req, res) => {
  return res.json({
    success: true,
    message: "Backend is running",
  });
});

/**
 * Docker connectivity check used by the readiness card.
 */
app.get("/api/docker/ping", (req, res) => {
  exec("docker ps", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Docker command failed",
        error: stderr || error.message,
      });
    }

    return res.json({
      success: true,
      message: "Docker is reachable",
      output: stdout,
    });
  });
});

/**
 * Small smoke container launch for backend-to-Docker proof.
 */
app.post("/api/docker/start-smoke", (req, res) => {
  exec(
    'docker run -d --rm --name atlas-smoke alpine sh -c "sleep 300"',
    (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to start test container",
          error: stderr || error.message,
        });
      }

      return res.json({
        success: true,
        message: "Test container started",
        containerId: stdout.trim(),
      });
    }
  );
});

/**
 * Temporary token validation endpoint for the reset-password page.
 *
 * This stays in the main backend entry because it is part of the global backend
 * surface, not a second standalone auth server.
 */
app.get("/api/auth/reset/validate", async (req, res) => {
  const { token } = req.query;
  //reject instantly if token is missing or is not a string
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "invalid_or_expired" });
  }
  //hash the incoming token so that we can compare it against the stored hash
  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  try {
    //look for a matcfhing token has that has not expired yet
    const result = await db.query(
      "SELECT 1 FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1",
      [tokenHash]
    );
    //if no match was found then the token has either expired or is invalid
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "invalid_or_expired" });
    }
    //return 200 if the token is valid and not expired
    return res.status(200).json({ valid: true });
  } catch (error) {
    //server error, log it but dont let client see
    console.error("RESET VALIDATION SERVER ERROR:", error);
    return res.status(400).json({ error: "invalid_or_expired" });
  }
});

/**
 * Disk-space readiness check for local launcher workflows.
 */
app.get("/api/storage/space", async (req, res) => {
  try {
    const diskSpace = await checkDiskSpace(path.resolve(__dirname));
    const freeSpaceInGB = diskSpace.free / 1024 ** 3;
    const requiredFreeSpaceInGB = 10;

    return res.json({
      success: freeSpaceInGB >= requiredFreeSpaceInGB,
      message:
        freeSpaceInGB >= requiredFreeSpaceInGB
          ? "Sufficient storage space"
          : "Insufficient storage space",
    });
  } catch (error) {
    console.error("STORAGE CHECK SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Storage check failed",
    });
  }
});

/**
 * Forgot-password endpoint.
 *
 * Note:
 * - This is intentionally in the single backend entry.
 * - Reset link now points to the normalized frontend route:
 *   /set-new-password?token=...
 */
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body ?? {};
  const genericResponse = () =>
    res.status(200).json({ message: "If that email is registered, a reset link has been sent." });
  if (!email) {
    return res.status(400).json({
      message: "Email is required.",
    });
  }

  if (!transporter) {
    return res.status(503).json({
      message: "Email service is not configured yet.",
    });
  }

  try {
    // TODO: Re-enable DB lookup when forgot-password is fully wired.
    // Example:
    // const result = await db.query("SELECT user_id FROM users WHERE email = $1", [email]);
    // if (result.rows.length === 0) {
    //   return res.status(404).json({ message: "No account found with that email." });
    // }

   const result = await db.query(
      "SELECT user_id FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return genericResponse();
    }

    const userId = result.rows[0].user_id;

    await db.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [userId]
    );

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP)`,
      [userId, tokenHash]
    );

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const resetLink = `${clientUrl}/set-new-password?token=${rawToken}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset",
      html: `
        <p>Click the link below to reset your password. It expires in 1 hour.</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>If you did not request this, you can safely ignore this email.</p>
      `,
    });

    return genericResponse();
  } catch (error) {
    console.error("FORGOT PASSWORD SERVER ERROR:", error);

    return res.status(500).json({
      message: "Server error. Please try again.",
    });
  }
});

















/**
 * Defensive guard:
 * If AuthRoutes is still not a function after this file replacement,
 * then Node is resolving the wrong file or the live file did not actually get replaced.
 */
if (typeof authRoutes !== "function") {
  throw new TypeError(
    `Expected ./routes/AuthRoutes to export a function, but received ${typeof authRoutes}`
  );
}

/**
 * Mount auth routes through the single backend entry.
 *
 * This preserves:
 * - /api/register
 * - /api/login
 * - /api/logout
 * - /api/me
 *
 * No second auth server. No split-brain startup path.
 */
app.use("/api", authRoutes(db));

/**
 * Final 404 for unknown API routes.
 */
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/**
 * Final error handler.
 */
app.use((err, req, res, next) => {
  console.error("UNHANDLED SERVER ERROR:", err);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

/**
 * Start the single backend after all middleware and routes are registered.
 */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
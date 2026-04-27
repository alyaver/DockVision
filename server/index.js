/**
 * Primary backend entry point.
 *
 * This server owns the full local application surface: authentication,
 * password reset, launcher/run APIs, Windows VM orchestration, readiness
 * probes, and background session cleanup. Keeping those concerns here avoids
 * split backend startup paths during development.
 */
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
const {
  createRunRecord,
  attachContainerId,
  markRunLaunchFailure,
  readRun,
  resolveRunFilePath,
} = require("./lib/runStore");
const {
  ensureWindowsVmRunning,
  getWindowsVmStatus,
  WINDOWS_VM_CONTAINER_NAME,
} = require("./lib/windowsVm");

const app = express();
const PORT = 5000;

const RESET_REQUEST_WINDOW_MINUTES = 15;
const MAX_UNIQUE_EMAILS_PER_IP = 3;

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
 * Create the run record first so the guest agent has a scoped task folder to
 * read from, then ensure the Windows VM is available for that run. If the VM
 * launch fails, we immediately mark the run as failed instead of leaving the
 * active channel stranded in a queued or running state.
 */
async function handleStartRun(req, res) {
  let createdRun = null;

  try {
    createdRun = await createRunRecord(req.body ?? {});
  } catch (error) {
    if (error.code === "RUN_ACTIVE") {
      return res.status(409).json({
        success: false,
        message: error.message,
        activeRunId: error.activeRunId,
      });
    }

    console.error("RUN CREATION SERVER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create isolated run",
    });
  }

  try {
    const windowsVm = await ensureWindowsVmRunning();
    const containerId = windowsVm.containerId || WINDOWS_VM_CONTAINER_NAME;

    await attachContainerId(createdRun.runId, containerId);
    const run = await readRun(createdRun.runId);

    return res.json({
      success: true,
      message: "Isolated test run started in the Windows VM guest",
      runId: createdRun.runId,
      containerId,
      windowsVm,
      run,
    });
  } catch (error) {
    try {
      await markRunLaunchFailure(
        createdRun.runId,
        error.message || "Windows VM failed to start for the requested run."
      );
    } catch (markError) {
      console.error("RUN FAILURE MARK ERROR:", markError);
    }

    console.error("RUN START SERVER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start isolated test run",
      error: error.message,
      runId: createdRun.runId,
    });
  }
}

app.post("/api/runs/start", handleStartRun);
// Keep the legacy route alive while older client code and saved workflows
// still refer to the original smoke-start endpoint name.
app.post("/api/docker/start-smoke", handleStartRun);

/**
 * Report the current Docker-backed Windows guest status without creating a run.
 * The dashboard polls this so users can tell "Docker is down" apart from
 * "Docker is fine, but the Windows guest has not been created yet."
 */
app.get("/api/windows-vm/status", async (req, res) => {
  try {
    const windowsVm = await getWindowsVmStatus();
    return res.json({
      success: windowsVm.available,
      windowsVm,
    });
  } catch (error) {
    console.error("WINDOWS VM STATUS SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to read Windows VM status",
      error: error.message,
    });
  }
});

/**
 * Start or resume the Docker-backed Windows guest without creating a run.
 * This gives us a manual recovery path when someone wants the VM up before
 * launching a test or needs to bring it back after deleting the container.
 */
app.post("/api/windows-vm/start", async (req, res) => {
  try {
    const windowsVm = await ensureWindowsVmRunning();
    return res.json({
      success: true,
      message: "Windows VM service is starting or already running",
      windowsVm,
    });
  } catch (error) {
    console.error("WINDOWS VM START SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to start the Windows VM service",
      error: error.message,
    });
  }
});

/**
 * Poll the current state of a single run and return its scoped artifacts/logs.
 */
app.get("/api/runs/:runId", async (req, res) => {
  try {
    const run = await readRun(req.params.runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        message: "Run not found",
      });
    }

    return res.json({
      success: true,
      run,
    });
  } catch (error) {
    console.error("RUN STATUS SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to read run status",
    });
  }
});

/**
 * Serve a file from a single run folder. This keeps screenshots and saved
 * artifacts scoped to the current run instead of reading from shared globals.
 */
app.get("/api/runs/:runId/files/*", async (req, res) => {
  try {
    const filePath = await resolveRunFilePath(req.params.runId, req.params[0] || "");
    return res.sendFile(filePath, (sendError) => {
      if (sendError && !res.headersSent) {
        res.status(sendError.statusCode || 404).json({
          success: false,
          message: "Run file not found",
        });
      }
    });
  } catch (error) {
    console.error("RUN FILE SERVER ERROR:", error);

    return res.status(404).json({
      success: false,
      message: "Run file not found",
    });
  }
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
  // normalize email 
  const rawEmail = req.body?.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  // generic response zero data 
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

  // request header for IP address tracking
  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";

  try {
    const rateLimitResult = await db.query(
      `SELECT COUNT(DISTINCT email)::int AS unique_email_count
       FROM password_reset_request_attempts
       WHERE ip_address = $1
         AND requested_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'`,
      [ipAddress]
    );

    const uniqueEmailCount = rateLimitResult.rows[0].unique_email_count;

    const existingEmailForIpResult = await db.query(
      `SELECT 1
       FROM password_reset_request_attempts
       WHERE ip_address = $1
         AND email = $2
         AND requested_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       LIMIT 1`,
      [ipAddress, email]
    );

    const hasAlreadyTriedThisEmail = existingEmailForIpResult.rows.length > 0;

    if (uniqueEmailCount >= MAX_UNIQUE_EMAILS_PER_IP && !hasAlreadyTriedThisEmail) {
      return res.status(429).json({
        message: "Please wait a few minutes before trying again.",
      });
    }

    await db.query(
      `INSERT INTO password_reset_request_attempts (email, ip_address)
       VALUES ($1, $2)`,
      [email, ipAddress]
    );

    // TODO: Re-enable DB lookup when forgot-password is fully wired.
    // Example:
    // const result = await db.query("SELECT user_id FROM users WHERE email = $1", [email]);
    // if (result.rows.length === 0) {
    //   return res.status(404).json({ message: "No account found with that email." });
    // }

   const result = await db.query(
      "SELECT user_id FROM users WHERE email = $1",
      [email]
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
app.use("/api/auth", authRoutes(db)); //updated path to /api/auth according to jira task #211

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
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute for testing

async function cleanupExpiredSessions() {
  try {
    console.log("cleanup tick");
    const result = await db.query(
      `DELETE FROM sessions
       WHERE expires_at <= CURRENT_TIMESTAMP`
    );
  } catch (error) {
    console.error("SESSION CLEANUP ERROR:", error);
  }
}

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);

  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
});

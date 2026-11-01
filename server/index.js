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
const { readMailConfiguration } = require("./lib/mailConfig");
//keeps reset-request behavior independently testable while the main server supplies live dependencies.
const { createForgotPasswordRouter } = require("./routes/ForgotPasswordRoutes");
const db = require("./db/db");
const authRoutes = require("./routes/AuthRoutes");
const { createRunLaunchRouter } = require("./routes/RunLaunchRoutes");
const { createRunAccessRouter } = require("./routes/RunAccessRoutes");
const { createProfileRouter } = require("./routes/ProfileRoutes");
const {
  createRequireAuthenticatedUser,
} = require("./middleware/requireAuthenticatedUser");
const { resumeActiveRun } = require("./lib/runRecovery");
const { createAccountDeletionService } = require("./lib/accountDeletion");
const { createLaunchService } = require("./lib/launchService");
const { pruneCompletedRuns } = require("./lib/runStore");
const { createRunCleanupScheduler } = require("./lib/runCleanupScheduler");
const {
  ensureWindowsVmRunning,
  getWindowsVmStatus,
} = require("./lib/windowsVm");

const app = express();
const PORT = 5000;
const requireAuthenticatedUser = createRequireAuthenticatedUser({ db });
const accountDeletionService = createAccountDeletionService({ db });
const launch = createLaunchService({
  beforePublish: pruneCompletedRuns,
  assertOwnerCanLaunch: async (userId) => {
    const result = await db.query("SELECT deletion_status FROM users WHERE user_id = $1", [userId]);
    if (result.rows[0]?.deletion_status !== "active") {
      const error = new Error("This account is being deleted and cannot start new work.");
      error.status = 423;
      error.code = "ACCOUNT_DELETION_PENDING";
      throw error;
    }
  },
});

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

app.use(cookieParser());
app.use(createRunLaunchRouter({ requireAuthenticatedUser, launch }));
app.use(createRunAccessRouter({ requireAuthenticatedUser }));
app.use(express.json({ limit: "8mb" }));
app.use("/api/profile", createProfileRouter({ db, requireAuthenticatedUser }));

//builds the SMTP transport only from the validated server-side settings so an unsafe reset origin disables delivery.
function createMailTransporter() {
  const mailConfiguration = readMailConfiguration();

  //keeps unrelated backend features available when reset-email configuration is absent or malformed.
  if (!mailConfiguration) {
    console.warn(
      "Email transporter not initialized. Check EMAIL_* settings and CLIENT_URL."
    );
    return null;
  }

  return nodemailer.createTransport({
    host: mailConfiguration.host,
    port: mailConfiguration.port,
    //uses implicit TLS only for port 465; port 587 uses the provider's STARTTLS negotiation.
    secure: mailConfiguration.port === 465,
    auth: {
      user: mailConfiguration.user,
      pass: mailConfiguration.pass,
    },
  });
}

const transporter = createMailTransporter();
//retains the normalized origin and sender that were accepted when the transport was created.
const mailConfiguration = readMailConfiguration();

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

//mounts the established public URL without letting request code choose its database, mail transport, or origin.
app.use("/api/forgot-password", createForgotPasswordRouter({ db, transporter, mailConfiguration }));

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
app.use("/api/auth", authRoutes(db, { deletionService: accountDeletionService })); //updated path to /api/auth according to jira task #211

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

  // A restart destroys the previous in-process supervision promise. Reattach it
  // after the listener is ready so persisted active work can continue advancing.
  resumeActiveRun().then((runId) => {
    if (runId) console.log(`Resumed supervision for active run '${runId}'.`);
  }).catch((error) => {
    console.error("RUN RECOVERY STARTUP ERROR:", error);
  });
  //request retention after the listener starts so cleanup cannot delay backend availability
  //starts fail-closed retention passes without delaying backend availability or guest recovery
  createRunCleanupScheduler().start();
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
});

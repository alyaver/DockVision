const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_EMAIL_LENGTH = 50;
const MAX_PASSWORD_LENGTH = 64;

/**
 * Normalize name input so the database receives a clean value.
 */
function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/**
 * Normalize email input so lookups are consistent.
 */
function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Basic name validation for the current project rules.
 */
function isValidName(value) {
  return /^[A-Za-z][A-Za-z\s'-]{1,29}$/.test(value);
}

/**
 * Basic email validation for the current project rules.
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

/**
 * Strong password rule used by registration.
 */
function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,64}$/.test(
    value
  );
}

/**
 * IMPORTANT:
 * Export a single CommonJS factory function.
 *
 * Why this fixes your crash:
 * - server/index.js is calling authRoutes(db)
 * - That means require("./routes/AuthRoutes") MUST return a function
 * - If the live main-branch file was exporting an object, router, named export,
 *   or a merge-damaged module shape, Node would throw:
 *   "TypeError: authRoutes is not a function"
 */
module.exports = function authRoutes(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error(
      "AuthRoutes requires a database pool/client object with a query() method."
    );
  }

  const router = express.Router();

  /**
   * Return the currently authenticated user based on the session cookie.
   */
  router.get("/me", async (req, res) => {
    try {
      const token = req.cookies.session_token;

      if (!token) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const result = await db.query(
        `SELECT
           u.user_id,
           u.name,
           u.email
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.session_token = $1
           AND s.expires_at > CURRENT_TIMESTAMP`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      return res.json({ user: result.rows[0] });
    } catch (error) {
      console.error("ME SERVER ERROR:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /**
   * Register a new user and immediately create a session.
   */
  router.post("/register", async (req, res) => {
    try {
      const name = normalizeName(req.body.name);
      const email = normalizeEmail(req.body.email);
      const password =
        typeof req.body.password === "string" ? req.body.password : "";
      const confirmPassword =
        typeof req.body.confirmPassword === "string"
          ? req.body.confirmPassword
          : "";

      if (!name || !email || !password || !confirmPassword) {
        return res.status(400).json({
          message:
            "Name, email, password, and confirm password are required",
        });
      }

      if (!isValidName(name)) {
        return res.status(400).json({
          message:
            "Name must be 2 to 30 characters and contain only letters, spaces, apostrophes, or hyphens",
        });
      }

      if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
        return res.status(400).json({
          message:
            "Email must be valid and end in .com, .gov, .edu, .net, or .org",
        });
      }

      if (password.length > MAX_PASSWORD_LENGTH || !isStrongPassword(password)) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          message: "Passwords do not match",
        });
      }

      const existingUser = await db.query(
        "SELECT user_id FROM users WHERE email = $1",
        [email]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({ message: "Email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const insertedUser = await db.query(
        `INSERT INTO users (
          name,
          email,
          password_hash,
          created_at,
          updated_at,
          failed_login_count,
          lock_until
        )
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL)
        RETURNING user_id, name, email, created_at`,
        [name, email, passwordHash]
      );

      const user = insertedUser.rows[0];
      const sessionToken = crypto.randomBytes(32).toString("hex");

      await db.query(
        `INSERT INTO sessions (
          user_id,
          session_token,
          created_at,
          expires_at
        )
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '2 hours')`,
        [user.user_id, sessionToken]
      );

      /**
       * Dev-friendly cookie settings.
       * Secure=false is intentional for local HTTP development.
       */
      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 2 * 60 * 60 * 1000,
      });

      return res.status(201).json({ user });
    } catch (error) {
      console.error("REGISTER SERVER ERROR:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /**
   * Log in an existing user and create a session record.
   */
  router.post("/login", async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password =
        typeof req.body.password === "string" ? req.body.password : "";

      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Email and password are required" });
      }

      if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
        return res.status(400).json({
          message:
            "Email must be valid and end in .com, .gov, .edu, .net, or .org",
        });
      }

      if (password.length > MAX_PASSWORD_LENGTH) {
        return res.status(400).json({ message: "Invalid password" });
      }

      const result = await db.query(
        `SELECT
          user_id,
          name,
          email,
          password_hash,
          failed_login_count,
          lock_until
        FROM users
        WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const user = result.rows[0];

      if (user.lock_until && new Date(user.lock_until) > new Date()) {
        return res
          .status(423)
          .json({ message: "Account is temporarily locked. Try again later." });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        const newFailedCount = user.failed_login_count + 1;

        if (newFailedCount >= MAX_FAILED_ATTEMPTS) {
          await db.query(
            `UPDATE users
             SET
               failed_login_count = $1,
               lock_until = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
               updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2`,
            [newFailedCount, user.user_id]
          );

          return res
            .status(423)
            .json({ message: "Account locked due to too many failed attempts" });
        }

        await db.query(
          `UPDATE users
           SET
             failed_login_count = $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2`,
          [newFailedCount, user.user_id]
        );

        return res.status(401).json({ message: "Invalid email or password" });
      }

      await db.query(
        `UPDATE users
         SET
           failed_login_count = 0,
           lock_until = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [user.user_id]
      );

      const sessionToken = crypto.randomBytes(32).toString("hex");

      await db.query(
        `INSERT INTO sessions (
          user_id,
          session_token,
          created_at,
          expires_at
        )
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '2 hours')`,
        [user.user_id, sessionToken]
      );

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 2 * 60 * 60 * 1000,
      });

      return res.json({
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      console.error("LOGIN SERVER ERROR:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  /**
   * Log out the current user by deleting the session and clearing the cookie.
   */
  router.post("/logout", async (req, res) => {
    try {
      const token = req.cookies.session_token;

      if (token) {
        await db.query("DELETE FROM sessions WHERE session_token = $1", [token]);
      }

      res.clearCookie("session_token");
      return res.status(204).send();
    } catch (error) {
      console.error("LOGOUT SERVER ERROR:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
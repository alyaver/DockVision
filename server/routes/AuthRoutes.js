const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;

function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = function authRoutes(db) {
  const router = express.Router();

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

      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Please enter a valid email address",
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

      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Please enter a valid email address",
        });
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
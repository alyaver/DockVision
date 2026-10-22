const express = require("express");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12;
const MAX_EMAIL_LENGTH = 50;
const MAX_PASSWORD_LENGTH = 64;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/png", "image/jpeg"]);

// Normalize name input so the database receives a clean value.
function normalizeName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

// Normalize email input so lookups are consistent.
function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Basic name validation for the current project rules.
 */
function isValidName(value) {
  return /^[A-Za-z][A-Za-z\s'-]{2,29}$/.test(value);
}

/**
 * Basic email validation for the current project rules.
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.(com|gov|edu|net|org)$/i.test(value);
}

/**
 * Strong password rule used by profile.
 */
function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,64}$/.test(
    value
  );
}

function userQuery() {
  return `SELECT user_id, name, email, created_at,
                 (avatar_data IS NOT NULL) AS has_avatar,
                 avatar_updated_at
          FROM users
          WHERE user_id = $1`;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      return null;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function readImageDimensions(buffer, contentType) {
  return contentType === "image/png" ? readPngDimensions(buffer) : readJpegDimensions(buffer);
}

// Returns only the necessary info about the user.
// This protects their password hash or other sensitive database fields from being accessed.
function safeUser(row) {
  return {
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    created_at: row.created_at,
    has_avatar: Boolean(row.has_avatar),
    avatar_updated_at: row.avatar_updated_at || null,
  };
}

function createProfileRouter({ db, requireAuthenticatedUser }) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Profile routes require a database query() method.");
  }
  if (typeof requireAuthenticatedUser !== "function") {
    throw new Error("Profile routes require authenticated-user middleware.");
  }

  const router = express.Router();
  // keeps things relevant to the current user
  router.use(requireAuthenticatedUser);

  // Provides the relevant user info to be displayed on the profile page
  router.get("/", async (req, res, next) => {
    try {
      const result = await db.query(userQuery(), [req.auth.userId]);
      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Profile not found",
        });
      }
      return res.json({ user: safeUser(result.rows[0]) });
    } catch (error) {
      return next(error);
    }
  });

  // Validates changes to the user's name and email from the profile page
  // Then, if valid, updates those fields on the user's account in the database
  router.patch("/", async (req, res, next) => {
    const name = normalizeName(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    if (!isValidName(name)) {
      return res.status(400).json({
        message: "Name must be 2 to 30 characters and contain only aplhanumeric characters or spaces",
      });
    }
    if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
      return res.status(400).json({
        message: "Email must be valid and end in .com, .gov, .edu, .net, or .org",
      });
    }
    try {
      const result = await db.query(
        `UPDATE users SET name = $1, email = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3
         RETURNING user_id, name, email, created_at, (avatar_data IS NOT NULL) AS has_avatar, avatar_updated_at`,
        [name, email, req.auth.userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Profile not found",
        });
      }
      return res.json({ user: safeUser(result.rows[0]) });
    } catch (error) {
      // Gives specific feedback for if the updated email is already being used by another user
      if (error.code === "23505") {
        return res.status(409).json({
          message: "Email already registered with another user",
        });
      }
      return next(error);
    }
  });

  // Validates changes to the user's password from the profile page
  // Then, if valid, updates it on the user's account in the database
  router.post("/password", async (req, res, next) => {
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!currentPassword) {
      return res.status(400).json({
        message: "Current password is required",
      });
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH || !isStrongPassword(newPassword)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters and include uppercase, lowercase, number, and symbol",
      });
    }
    try {
      const result = await db.query(
        `SELECT password_hash
         FROM users
         WHERE user_id = $1`,
        [req.auth.userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Profile not found",
        });
      }
      if (!(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
        return res.status(401).json({
          message: "Current password is incorrect",
        });
      }
      const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await db.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [passwordHash, req.auth.userId]
      );
      return res.json({
        message: "Password changed successfully",
      });
    } catch (error) {
      return next(error);
    }
  });

  // Validates changes to the user's profile picture/avatar from the profile page
  // Then, if valid, updates it on the user's account in the database
  router.put("/avatar", async (req, res, next) => {
    const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : "";
    const encoded = typeof req.body?.data === "string" ? req.body.data : "";
    if (!AVATAR_TYPES.has(contentType)) {
      return res.status(400).json({
        message: "Profile picture must be a PNG or JPEG image",
      });
    }
    let buffer;
    try {
      if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new Error("Invalid base64");
      }
      buffer = Buffer.from(encoded, "base64");
      if (buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
        throw new Error("Invalid base64");
      }
    } catch {
      return res.status(400).json({
        message: "Profile picture data is invalid",
      });
    }
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({
        message: "Profile picture is empty or too large",
      });
    }
    const dimensions = readImageDimensions(buffer, contentType);
    if (!dimensions || dimensions.width !== dimensions.height) {
      return res.status(400).json({
        message: "Profile picture must be normalized to a square image",
      });
    }
    try {
      await db.query(
        `UPDATE users SET avatar_data = $1, avatar_content_type = $2, avatar_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3`,
        [buffer, contentType, req.auth.userId]
      );
      return res.json({ has_avatar: true });
    } catch (error) {
      return next(error);
    }
  });

  // Provides the user's profile picture/avatar info so that it can be displayed on the profile page and NavBar
  router.get("/avatar", async (req, res, next) => {
    try {
      const result = await db.query(
        `SELECT avatar_data, avatar_content_type, avatar_updated_at
         FROM users
         WHERE user_id = $1`,
        [req.auth.userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).end();
      }
      const avatar = result.rows[0];
      if (!avatar.avatar_data) {
        return res.status(404).end();
      }
      res.set("Content-Type", avatar.avatar_content_type || "application/octet-stream");
      res.set("Cache-Control", "private, max-age=300");
      return res.send(avatar.avatar_data);
    } catch (error) {
      return next(error);
    }
  });

  // Clears the user's profile picture/avatar related data from the database,
  // reverting them back to the default/fallback avatar.
  router.delete("/avatar", async (req, res, next) => {
    try {
      await db.query(
        `UPDATE users SET avatar_data = NULL, avatar_content_type = NULL, avatar_updated_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [req.auth.userId]
      );
      return res.json({ has_avatar: false });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createProfileRouter };
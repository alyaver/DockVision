/**
 * Legacy auth-focused server entry.
 *
 * This file preserves a smaller auth-only Express setup used by some older
 * local workflows. When it changes, keep its route mounting and middleware
 * behavior aligned with the main backend entry so auth behavior does not drift.
 */
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const db = require("./db/db");
const authRoutes = require("./routes/AuthRoutes");

const app = express();
const PORT = 5000;

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Auth server is running",
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW()");
    res.json({
      success: true,
      time: result.rows[0],
    });
  } catch (error) {
    console.error("DB test failed:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.use("/api/auth", authRoutes(db)); //updated path to /api/auth according to jira task #211

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

app.listen(PORT, () => {
  console.log(`Auth server running on http://localhost:${PORT}`);
});

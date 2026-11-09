const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

const enabled = process.env.DOCKVISION_POSTGRES_TEST === "1";
const testOrSkip = enabled ? test : test.skip;

function adminConfig() {
  return {
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    password: process.env.DB_PASSWORD,
    database: process.env.DB_ADMIN_DATABASE || "postgres",
  };
}

async function withDisposableDatabase(t, callback) {
  const database = `dockvision_test_${process.pid}_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new Client(adminConfig());
  let client;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE \"${database}\"`);
    t.after(async () => {
      if (client) await client.end().catch((error) => t.diagnostic(`test connection cleanup failed: ${error.message}`));
      const cleanup = new Client(adminConfig());
      try {
        await cleanup.connect();
        await cleanup.query(`DROP DATABASE IF EXISTS \"${database}\" WITH (FORCE)`);
      } catch (error) {
        t.diagnostic(`database cleanup failed for ${database}: ${error.message}`);
        throw error;
      } finally {
        await cleanup.end().catch((error) => t.diagnostic(`cleanup connection close failed: ${error.message}`));
      }
    });
  } finally {
    await admin.end().catch((error) => t.diagnostic(`admin connection cleanup failed: ${error.message}`));
  }

  client = new Client({ ...adminConfig(), database });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  try {
    await client.query(schema);
  } catch (error) {
    t.diagnostic(`database setup failed for ${database}: ${error.message}`);
    throw error;
  }
  return callback(client);
}

testOrSkip("PostgreSQL schema enforces unique emails and cascades sessions", async (t) => {
  await withDisposableDatabase(t, async (client) => {
    const first = await client.query(
      "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING user_id",
      ["first@example.com", "hash", "First User"]
    );
    await assert.rejects(
      client.query(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)",
        ["first@example.com", "hash", "Duplicate User"]
      ),
      (error) => error.code === "23505"
    );
    await client.query("ROLLBACK");

    await client.query(
      "INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '2 hours')",
      [first.rows[0].user_id, "session-to-cascade"]
    );
    await client.query("DELETE FROM users WHERE user_id = $1", [first.rows[0].user_id]);
    const sessions = await client.query("SELECT * FROM sessions WHERE session_token = $1", ["session-to-cascade"]);
    assert.equal(sessions.rowCount, 0);
  });
});

testOrSkip("PostgreSQL transactions roll back partial account changes", async (t) => {
  await withDisposableDatabase(t, async (client) => {
    await client.query("INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)", ["rollback@example.com", "hash", "Rollback User"]);
    await assert.rejects((async () => {
      await client.query("BEGIN");
      await client.query("UPDATE users SET name = $1 WHERE email = $2", ["Changed User", "rollback@example.com"]);
      await client.query("INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)", ["rollback@example.com", "hash", "Duplicate"]);
    })(), /duplicate key/i);
    await client.query("ROLLBACK");

    const result = await client.query("SELECT name FROM users WHERE email = $1", ["rollback@example.com"]);
    assert.deepEqual(result.rows, [{ name: "Rollback User" }]);
  });
});
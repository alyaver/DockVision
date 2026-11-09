const { spawnSync } = require("node:child_process");
const path = require("node:path");

const result = spawnSync(
  process.execPath,
  ["--test", path.join(__dirname, "postgresIntegration.test.js")],
  {
    env: { ...process.env, DOCKVISION_POSTGRES_TEST: "1" },
    stdio: "inherit",
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
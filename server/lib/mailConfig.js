//normalizes string settings before validation so whitespace-only secrets and origins cannot enable delivery.
function readRequiredValue(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

//returns one trusted server-side mail configuration or null when any value could produce an unsafe reset link.
function readMailConfiguration(env = process.env) {
  const host = readRequiredValue(env, "EMAIL_HOST");
  const portText = readRequiredValue(env, "EMAIL_PORT");
  const user = readRequiredValue(env, "EMAIL_USER");
  const pass = readRequiredValue(env, "EMAIL_PASS");
  const clientUrl = readRequiredValue(env, "CLIENT_URL");
  const port = Number(portText);

  //rejects the whole configuration instead of allowing a transporter with incomplete credentials or an invalid port.
  if (!host || !user || !pass || !clientUrl || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  try {
    const origin = new URL(clientUrl);
    //requires a bare web origin because the reset route and token are appended by the server below.
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      !origin.hostname ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }

    //uses URL.origin to remove a harmless trailing slash and keep every generated link canonical.
    return {
      host,
      port,
      user,
      pass,
      clientUrl: origin.origin,
    };
  } catch {
    //treats malformed URLs like other unavailable configuration without exposing configuration details to callers.
    return null;
  }
}

module.exports = { readMailConfiguration };
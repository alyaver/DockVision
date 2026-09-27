const { readTestScript } = require("./test-script/readTestScript");

class LaunchError extends Error {
  constructor(status, code, message, fieldErrors = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function invalid(field, message) {
  throw new LaunchError(400, "INVALID_LAUNCH_REQUEST", message, [{ path: field, message }]);
}

function validateLaunchRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("body", "Launch request must be a JSON object.");
  }
  if (!["builtin", "custom"].includes(input.executionMode)) {
    invalid("executionMode", "Choose builtin or custom execution mode.");
  }
  for (const field of ["testName", "configFileName", "configContent"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      invalid(field, `${field} must be a nonempty string.`);
    }
  }
  if (!input.configFileName.toLowerCase().endsWith(".json")) {
    invalid("configFileName", "Configuration must use a .json filename.");
  }
  for (const field of ["taskType", "payload"]) {
    if (Object.hasOwn(input, field)) invalid(field, `${field} is assigned by the server.`);
  }
  const supplied = input.runOptions === undefined ? {} : input.runOptions;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    invalid("runOptions", "runOptions must be an object.");
  }
  const runOptions = { iterations: 1, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 };
  for (const key of Object.keys(supplied)) {
    if (!Object.hasOwn(runOptions, key)) invalid(`runOptions.${key}`, "Unknown run option.");
    runOptions[key] = supplied[key];
  }
  if (!Number.isInteger(runOptions.iterations) || runOptions.iterations < 1 || runOptions.iterations > 30) {
    invalid("runOptions.iterations", "Iterations must be an integer from 1 to 30.");
  }
  if (![5, 10, 30, 60].includes(runOptions.captureIntervalSeconds)) {
    invalid("runOptions.captureIntervalSeconds", "Capture interval must be 5, 10, 30, or 60 seconds.");
  }
  if (!Number.isSafeInteger(runOptions.iterationTimeoutSeconds) || runOptions.iterationTimeoutSeconds < 1) {
    invalid("runOptions.iterationTimeoutSeconds", "Iteration timeout must be a positive integer.");
  }

  const request = { ...input, testName: input.testName.trim(), runOptions };
  const runnerFields = ["runnerScriptName", "runnerScriptContent", "runnerScriptLanguage"];
  if (input.executionMode === "builtin") {
    for (const field of runnerFields) {
      if (Object.hasOwn(input, field)) invalid(field, "Built-in mode does not accept runner fields.");
    }
    request.plan = readTestScript({ fileName: input.configFileName, content: input.configContent });
  } else {
    for (const field of runnerFields) {
      if (typeof input[field] !== "string" || !input[field].trim()) invalid(field, `${field} is required.`);
    }
    if (!["python", "powershell"].includes(input.runnerScriptLanguage)) {
      invalid("runnerScriptLanguage", "Runner language must be python or powershell.");
    }
    const extension = input.runnerScriptLanguage === "python" ? ".py" : ".ps1";
    if (!input.runnerScriptName.toLowerCase().endsWith(extension)) {
      invalid("runnerScriptName", "Runner filename must match its declared language.");
    }
    try {
      JSON.parse(input.configContent.replace(/^\uFEFF/, ""));
    } catch {
      invalid("configContent", "Custom configuration must contain valid JSON.");
    }
  }
  return request;
}

module.exports = { LaunchError, validateLaunchRequest };
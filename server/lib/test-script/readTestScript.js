const path = require("path");
const SCHEMA_VERSION = "dockvision.plan.v1"; // referenced from runner-contract-demo (task-plan.json)

class TestScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = "TestScriptError";
    this.code = "INVALID_TEST_SCRIPT";
  }
}

// Example of a valid script (referenced from task-plan.json):
//     "id": "step-2",
//     "action": "TYPE",
//     "text": "This is a DockVision TYPE task from task-plan.json."
function readTestScript({ fileName, content }) {
  const extension = path.extname(String(fileName || "")).toLowerCase(); // check if the file extension is valid
  if (extension !== ".json") {
    throw new TestScriptError("Runner script must use .json extension.");
  }

  if (typeof content !== "string" || content.trim() === "") {   
    throw new TestScriptError("Runner script content is required.");
  }

  let action;
  try {
    action = JSON.parse(content.replace(/^\uFEFF/, "")); // remove BOM if present
  } catch {
    throw new TestScriptError("DOCKVISION action contains invalid JSON.");
  }

  // need to confirm if schemaVersion is required and if it should be validated against SCHEMA_VERSION
  //if (action.schemaVersion !== SCHEMA_VERSION) {
  //  throw new TestScriptError(`Action must use schemaVersion '${SCHEMA_VERSION}'.`);
  //}

  if (!Array.isArray(action.steps) || action.steps.length === 0) {
    throw new TestScriptError("DOCKVISION action must contain at least one step.");
  }

  const seenIds = new Set(); // to track unique step ids

  for (const step of action.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new TestScriptError("Each action step must be a JSON object.");
    }

    if (typeof step.id !== "string" || !step.id.trim()) {
      throw new TestScriptError("Each action step requires an id.");
    }

    if (seenIds.has(step.id)) {
      throw new TestScriptError(`Action step id '${step.id}' is duplicated.`);
    }

    seenIds.add(step.id); // mark this id as seen

    if (step.action === "TYPE") {
      if (typeof step.text !== "string" || step.text.length === 0) {
        throw new TestScriptError(`TYPE step '${step.id}' requires a nonempty text string.`);
      }
    }
  }

  return action;
}

module.exports = {
  SCHEMA_VERSION,
  TestScriptError,
  readTestScript,
};
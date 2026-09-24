const path = require("path");
const SCHEMA_VERSION = "dockvision.user-task-plan.v1";
const NAMED_TARGETS = new Set(["editor", "fileMenu", "editMenu", "formatMenu", "viewMenu", "helpMenu"]);

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

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new TestScriptError("Task plan must be a JSON object.");
  }

  if (action.schemaVersion !== SCHEMA_VERSION) {
    throw new TestScriptError(`Task plan must use schemaVersion '${SCHEMA_VERSION}'.`);
  }

  if (!Array.isArray(action.tasks) || action.tasks.length === 0) {
    throw new TestScriptError("DOCKVISION action must contain at least one task.");
  }

  const seenIds = new Set(); // to track unique step ids

  for (const step of action.tasks) {
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

    if (step.action !== "TYPE" && step.action !== "CLICK") {
      throw new TestScriptError(`Task '${step.id}' action must be TYPE or CLICK.`);
    }

    const allowedFields = step.action === "TYPE"
      ? ["id", "action", "text"]
      : ["id", "action", "target", "button", "clickCount"];
    for (const field of Object.keys(step)) {
      if (!allowedFields.includes(field)) {
        throw new TestScriptError(`${step.action} task '${step.id}' does not support field '${field}'.`);
      }
    }

    if (step.action === "TYPE") {
      if (typeof step.text !== "string" || step.text.length === 0) {
        throw new TestScriptError(`TYPE step '${step.id}' requires a nonempty text string.`);
      }
    } else {
      const target = step.target;
      if (typeof target === "string") {
        if (!NAMED_TARGETS.has(target)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires a supported named target.`);
        }
      } else {
        if (!target || typeof target !== "object" || Array.isArray(target)
            || !["screenPoint", "windowPoint"].includes(target.type)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires a named target or a screenPoint/windowPoint target.`);
        }
        for (const field of Object.keys(target)) {
          if (!["type", "x", "y"].includes(field)) {
            throw new TestScriptError(`CLICK task '${step.id}' target does not support field '${field}'.`);
          }
        }
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires finite numbers for target.x and target.y.`);
        }
      }

      if (step.button === undefined) step.button = "left";
      if (step.clickCount === undefined) step.clickCount = 1;
      if (step.button !== "left" && step.button !== "right") {
        throw new TestScriptError(`CLICK task '${step.id}' button must be left or right.`);
      }
      if (step.clickCount !== 1 && step.clickCount !== 2) {
        throw new TestScriptError(`CLICK task '${step.id}' clickCount must be 1 or 2.`);
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

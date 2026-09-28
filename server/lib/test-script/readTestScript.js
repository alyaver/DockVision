const path = require("path");
const SCHEMA_VERSION = "dockvision.user-task-plan.v1";
const LEGACY_SCHEMA_VERSION = "dockvision.plan.v1";
// Detect supplied fields even when their value is null or otherwise falsy.
const hasField = (object, field) => Object.prototype.hasOwnProperty.call(object, field);
const NAMED_TARGETS = new Set(["editor", "fileMenu", "editMenu", "formatMenu", "viewMenu", "helpMenu"]);

class TestScriptError extends Error {
  constructor(message, fieldPath = "configContent", stepId = null) {
    super(message);
    this.name = "TestScriptError";
    this.code = "INVALID_TASK_PLAN";
    this.fieldErrors = [{ path: fieldPath, stepId, message }];
  }
}

// Example of a valid script (referenced from task-plan.json):
//     "id": "step-2",
//     "action": "TYPE",
//     "text": "This is a DockVision TYPE task from task-plan.json."
function readTestScript({ fileName, content }) {
  const extension = path.extname(String(fileName || "")).toLowerCase(); // check if the file extension is valid
  if (extension !== ".json") {
    throw new TestScriptError("Runner script must use .json extension.", "configFileName");
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

  const isLegacy = action.schemaVersion === LEGACY_SCHEMA_VERSION;
  if (!isLegacy && action.schemaVersion !== SCHEMA_VERSION) {
    throw new TestScriptError(`Task plan must use schemaVersion '${SCHEMA_VERSION}' or '${LEGACY_SCHEMA_VERSION}'.`, "schemaVersion");
  }
  const tasksField = isLegacy ? "steps" : "tasks";
  for (const [canonical, legacy] of [["tasks", "steps"], ["app", "targetApp"]]) {
    if (hasField(action, canonical) && hasField(action, legacy)) {
      throw new TestScriptError(`Task plan cannot contain both '${canonical}' and '${legacy}'.`, legacy);
    }
  }
  // Reject mixed envelopes rather than silently choosing one task list.
  for (const field of isLegacy ? ["tasks"] : ["steps", "targetApp"]) {
    if (hasField(action, field)) {
      throw new TestScriptError(`Task plan '${action.schemaVersion}' does not support '${field}'.`, field);
    }
  }

  const appField = isLegacy && hasField(action, "targetApp") ? "targetApp" : "app";
  const app = action[appField];
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    throw new TestScriptError(`Task plan requires an ${appField} object.`, appField);
  }
  if (typeof app.name !== "string" || app.name.toLowerCase() !== "notepad") {
    throw new TestScriptError(`${appField}.name must identify the supported application 'notepad'.`, `${appField}.name`);
  }
  if (typeof app.executable !== "string" || app.executable.toLowerCase() !== "notepad.exe") {
    throw new TestScriptError(`${appField}.executable must be 'notepad.exe'.`, `${appField}.executable`);
  }
  if (app.fileName !== undefined && (typeof app.fileName !== "string" || !app.fileName.trim())) {
    throw new TestScriptError(`${appField}.fileName must be a nonempty string when supplied.`, `${appField}.fileName`);
  }
  for (const field of ["uniqueFilePerRun", "resetFile"]) {
    if (app[field] !== undefined && typeof app[field] !== "boolean") {
      throw new TestScriptError(`${appField}.${field} must be a boolean when supplied.`, `${appField}.${field}`);
    }
  }

  if (!Array.isArray(action[tasksField]) || action[tasksField].length === 0) {
    throw new TestScriptError("DOCKVISION action must contain at least one task.", tasksField);
  }

  const seenIds = new Set(); // to track unique step ids

  for (const [index, step] of action[tasksField].entries()) {
    const taskPath = `${tasksField}[${index}]`;
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new TestScriptError("Each action step must be a JSON object.", taskPath);
    }

    if (typeof step.id !== "string" || !step.id.trim()) {
      throw new TestScriptError("Each action step requires an id.", `${taskPath}.id`);
    }

    if (seenIds.has(step.id)) {
      throw new TestScriptError(`Action step id '${step.id}' is duplicated.`, `${taskPath}.id`, step.id);
    }

    seenIds.add(step.id); // mark this id as seen

    // Supported demo imports place named-control percentages on the task.
    // Normalize them into an explicit target before checking action fields.
    if (step.action === "CLICK" && (hasField(step, "xPercent") || hasField(step, "yPercent"))) {
      if (typeof step.target === "string") step.target = { type: "namedControl", name: step.target };
      if (!step.target || step.target.type !== "namedControl") {
        throw new TestScriptError("Percentages require a named-control target.", `${taskPath}.target`, step.id);
      }
      for (const field of ["xPercent", "yPercent"]) {
        if (!hasField(step, field)) continue;
        if (hasField(step.target, field)) {
          throw new TestScriptError(`Do not supply competing ${field} values.`, `${taskPath}.${field}`, step.id);
        }
        step.target[field] = step[field];
        delete step[field];
      }
    }

    if (step.action !== "TYPE" && step.action !== "CLICK") {
      throw new TestScriptError(`Task '${step.id}' action must be TYPE or CLICK.`, `${taskPath}.action`, step.id);
    }

    const allowedFields = step.action === "TYPE"
      ? ["id", "action", "text"]
      : ["id", "action", "target", "button", "clickCount", "xPercent", "yPercent"];
    for (const field of Object.keys(step)) {
      if (!allowedFields.includes(field)) {
        throw new TestScriptError(`${step.action} task '${step.id}' does not support field '${field}'.`, `${taskPath}.${field}`, step.id);
      }
    }

    if (step.action === "TYPE") {
      if (typeof step.text !== "string" || step.text.length === 0) {
        throw new TestScriptError(`TYPE step '${step.id}' requires a nonempty text string.`, `${taskPath}.text`, step.id);
      }
    } else {
      if (typeof step.target === "string" && step.target.startsWith("notepad.") && NAMED_TARGETS.has(step.target.slice(8))) {
        step.target = step.target.slice(8);
      } else if (step.target?.type === "namedControl" && typeof step.target.name === "string"
          && step.target.name.startsWith("notepad.") && NAMED_TARGETS.has(step.target.name.slice(8))) {
        step.target.name = step.target.name.slice(8);
      }
      // Older demos place named-control percentages on the task itself.
      // Normalize both supported envelopes to an explicit namedControl target.
      for (const field of ["xPercent", "yPercent"]) {
        if (!hasField(step, field)) continue;
        const namedTarget = typeof step.target === "string"
          ? NAMED_TARGETS.has(step.target)
          : step.target?.type === "namedControl";
        if (!namedTarget) {
          throw new TestScriptError(`CLICK task '${step.id}' ${field} requires a named-control target.`, `${taskPath}.${field}`, step.id);
        }
        if (!Number.isFinite(step[field]) || step[field] < 0 || step[field] > 100) {
          throw new TestScriptError(`CLICK task '${step.id}' ${field} must be a number from 0 to 100.`, `${taskPath}.${field}`, step.id);
        }
        if (typeof step.target === "string") {
          step.target = { type: "namedControl", name: step.target };
        }
        if (hasField(step.target, field) && step.target[field] !== step[field]) {
          throw new TestScriptError(`CLICK task '${step.id}' has conflicting ${field} values.`, `${taskPath}.${field}`, step.id);
        }
        step.target[field] = step[field];
        delete step[field];
      }
      const target = step.target;
      if (typeof target === "string") {
        if (!NAMED_TARGETS.has(target)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires a supported named target.`, `${taskPath}.target`, step.id);
        }
      } else {
        if (!target || typeof target !== "object" || Array.isArray(target)
            || !["namedControl", "screenPoint", "windowPoint"].includes(target.type)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires a named target or a screenPoint/windowPoint target.`, `${taskPath}.target`, step.id);
        }
        // Explicit named controls use a name and optional percentages; point targets use x/y.
        const targetFields = target.type === "namedControl"
          ? ["type", "name", "xPercent", "yPercent"]
          : ["type", "x", "y"];
        for (const field of Object.keys(target)) {
          if (!targetFields.includes(field)) {
            throw new TestScriptError(`CLICK task '${step.id}' target does not support field '${field}'.`, `${taskPath}.target.${field}`, step.id);
          }
        }
        // Apply the same supported-control list to string and object target forms.
        if (target.type === "namedControl" && !NAMED_TARGETS.has(target.name)) {
          throw new TestScriptError(`CLICK task '${step.id}' requires a supported named control.`, `${taskPath}.target.name`, step.id);
        }
        // Only point targets require numeric coordinates.
        for (const coordinate of target.type === "namedControl" ? [] : ["x", "y"]) {
          if (!Number.isFinite(target[coordinate])) {
            throw new TestScriptError(`CLICK task '${step.id}' requires a finite number for target.${coordinate}.`, `${taskPath}.target.${coordinate}`, step.id);
          }
        }
      }

      // Percentages belong inside explicit named-control targets and must be within 0–100.
      for (const field of ["xPercent", "yPercent"]) {
        if (typeof target === "object" && target.type === "namedControl" && hasField(target, field)
            && (!Number.isFinite(target[field]) || target[field] < 0 || target[field] > 100)) {
          throw new TestScriptError(`CLICK task '${step.id}' target.${field} must be a number from 0 to 100.`, `${taskPath}.target.${field}`, step.id);
        }
      }

      if (step.button === undefined) step.button = "left";
      if (step.clickCount === undefined) step.clickCount = 1;
      if (step.button !== "left" && step.button !== "right") {
        throw new TestScriptError(`CLICK task '${step.id}' button must be left or right.`, `${taskPath}.button`, step.id);
      }
      if (step.clickCount !== 1 && step.clickCount !== 2) {
        throw new TestScriptError(`CLICK task '${step.id}' clickCount must be 1 or 2.`, `${taskPath}.clickCount`, step.id);
      }
    }
  }

  // The run store and guest agent consume one canonical execution format.
  if (isLegacy) {
    action.schemaVersion = SCHEMA_VERSION;
    action.tasks = action.steps;
    delete action.steps;
    action.app = app;
    delete action.targetApp;
  }
  return action;
}

module.exports = {
  SCHEMA_VERSION,
  TestScriptError,
  readTestScript,
};

const express = require("express");
const { createLaunchService } = require("../lib/launchService");
const { pruneCompletedRuns } = require("../lib/runStore");

//uploaded scripts can be bigger than the normal request limit
//only allow bigger uploads on the test run routes
const RUN_LAUNCH_JSON_LIMIT = "10mb";

function launchErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const validation = error.code === "INVALID_TASK_PLAN";
  const malformed = error.type === "entity.parse.failed";
  //tell the user when their uploaded files are too big
  const tooLarge = error.type === "entity.too.large";
  const status = tooLarge ? 413 : malformed || validation ? 400 : error.status || 500;
  const body = {
    success: false,
    code: tooLarge ? "REQUEST_TOO_LARGE" : malformed ? "INVALID_JSON" : status >= 500 ? "LAUNCH_FAILED" : error.code || "INVALID_LAUNCH_REQUEST",
    message: tooLarge ? "Runner script and task-plan uploads must be 10 MB or smaller." : malformed ? "Request body must contain valid JSON." : status >= 500 ? "Failed to admit the run. No new task was published." : error.message,
    fieldErrors: error.fieldErrors || [],
  };
  if (error.activeRunId) body.activeRunId = error.activeRunId;
  if (status >= 500) console.error("RUN ADMISSION ERROR:", error);
  return res.status(status).json(body);
}

function createRunLaunchRouter({ launch = createLaunchService({ beforePublish: pruneCompletedRuns }) } = {}) {
  const router = express.Router();
  //parse here, before the application's general parser, so aliases share JSON errors too.
  router.post(["/api/runs/start", "/api/runs/start2", "/api/docker/start-smoke"],
    //let these routes accept uploaded scripts up to 10mb
    express.json({ limit: RUN_LAUNCH_JSON_LIMIT }), async (req, res, next) => {
      try {
        const accepted = await launch(req.body);
        return res.status(202).json({ success: true, ...accepted });
      } catch (error) {
        return next(error);
      }
    });
  router.use(launchErrorHandler);
  return router;
}

module.exports = { createRunLaunchRouter, RUN_LAUNCH_JSON_LIMIT };
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const {
  listRuns,
  readRunForOwner,
  requestRunCancellationForOwner,
  requestRunCancellation2ForOwner,
  resolveRunFilePathForOwner,
} = require("../lib/runStore");

function createRunAccessRouter({
  requireAuthenticatedUser,
  list = listRuns,
  readOwned = readRunForOwner,
  cancelOwned = requestRunCancellationForOwner,
  cancelOwned2 = requestRunCancellation2ForOwner,
  resolveOwnedFile = resolveRunFilePathForOwner,
} = {}) {
  if (typeof requireAuthenticatedUser !== "function") {
    throw new Error("Run access routes require authenticated-user middleware.");
  }

  const router = express.Router();
  router.use("/api/runs", requireAuthenticatedUser);

  // Converts the json's "name" field into a safe "name.json" filename so that
  // it can be displayed clearly on the profile page's run artifacts sections.
  function sanitizeDownloadName(value) {
    const normalized = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 120);
    const safeName = normalized || "uploaded-task-plan";
    const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safeName)
      ? `download-${safeName}`
      : safeName;

    return `${reservedName}.json`;
  }

  // Gets the "name" field from the task plan .json file
  async function getTaskPlanDownloadName(filePath) {
    try {
      const parsed = JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
      return sanitizeDownloadName(parsed?.name);
    } catch {
      return "uploaded-task-plan.json";
    }
  }

  router.get("/api/runs", async (req, res) => {
    try {
      const runs = await list({ ownerUserId: req.auth.userId });
      return res.json({ success: true, runs });
    } catch (error) {
      console.error("RUN LIST SERVER ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load run history",
      });
    }
  });

  router.get("/api/runs/:runId", async (req, res) => {
    try {
      const run = await readOwned(req.params.runId, req.auth.userId);

      if (!run) {
        return res.status(404).json({ success: false, message: "Run not found" });
      }

      return res.json({ success: true, run });
    } catch (error) {
      console.error("RUN STATUS SERVER ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to read run status",
      });
    }
  });

  router.post("/api/runs/:runId/cancel", async (req, res) => {
    try {
      const run = await cancelOwned(req.params.runId, req.auth.userId);

      if (!run) {
        return res.status(404).json({ success: false, message: "Run not found." });
      }

      return res.json({
        success: true,
        message:
          run.status === "cancelling"
            ? "Cancellation requested."
            : `Run is already ${run.status}.`,
        run,
      });
    } catch (error) {
      console.error("RUN CANCELLATION ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to request run cancellation.",
      });
    }
  });

  router.post("/api/runs/:runId/cancel2", async (req, res) => {
    try {
      const cancellation = await cancelOwned2(req.params.runId, req.auth.userId);

      if (!cancellation) {
        return res.status(404).json({ success: false, message: "Run not found" });
      }

      return res.status(cancellation.terminal ? 200 : 202).json({
        success: true,
        run: cancellation.run,
      });
    } catch (error) {
      console.error("RUN CANCELLATION SERVER ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to request run cancellation",
      });
    }
  });

  router.get("/api/runs/:runId/files/*", async (req, res) => {
    try {
      const filePath = await resolveOwnedFile(
        req.params.runId,
        req.params[0] || "",
        req.auth.userId
      );

      if (!filePath) {
        return res.status(404).json({ success: false, message: "Run file not found" });
      }

      // Responsible for downloading the task plan .json file from the profile page's run artifacts
      // sections. This allows the user to download and reuse a previously used task plan.
      const requestedPath = String(req.params[0] || "").replace(/\\/g, "/");
      const isTaskPlan = ["uploaded-task-plan.json", "task-plan.json"].includes(
        path.posix.basename(requestedPath)
      );
      if (req.query.download === "1" && isTaskPlan) {
        const downloadName = await getTaskPlanDownloadName(filePath);
        return res.download(filePath, downloadName, (sendError) => {
          if (sendError && !res.headersSent) {
            res.status(sendError.statusCode || 404).json({
              success: false,
              message: "Run file not found",
            });
          }
        });
      }

      return res.sendFile(filePath, (sendError) => {
        if (sendError && !res.headersSent) {
          res.status(sendError.statusCode || 404).json({
            success: false,
            message: "Run file not found",
          });
        }
      });
    } catch (error) {
      console.error("RUN FILE SERVER ERROR:", error);
      return res.status(404).json({ success: false, message: "Run file not found" });
    }
  });

  return router;
}

module.exports = { createRunAccessRouter };
const express = require("express");
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
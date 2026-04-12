const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get("/api/docker/ping", (req, res) => {
  exec("docker ps", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Docker command failed",
        error: stderr || error.message,
      });
    }

    res.json({
      success: true,
      message: "Docker is reachable",
      output: stdout,
    });
  });
});

app.post("/api/docker/start-smoke", (req, res) => {
  exec(
    'docker run -d --rm --name atlas-smoke alpine sh -c "sleep 300"',
    (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to start test container",
          error: stderr || error.message,
        });
      }

      res.json({
        success: true,
        message: "Test container started",
        containerId: stdout.trim(),
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Backend is running' })
})
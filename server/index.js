const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const checkDiskSpace = require('check-disk-space').default;
const path = require('path');

const app = express();
const PORT = 5001; // changed from 5000 to 5001, app was crashing

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

app.get('/api/auth/reset/validate', (req, res) => {
  const { token } = req.query;

  //added for testing, test-token is accepted as valid, REMOVE WHEN TOKEN GENERATION is implemented
  if (token === 'test-token') {
    res.json({ valid: true });
  } else {
    res.json({ valid: false, message: 'Invalid or expired token' });
  }
});

// check disk space
app.get('/api/storage/space', async (req, res) => {
  try {
    const diskSpace = await checkDiskSpace(path.resolve(__dirname)); // check root disk space
    const totalGB = (diskSpace.free / (1024 ** 3));
    const neededGB = 10; // assume we need at least 10GB free for test runs

    res.json({
      success: totalGB >= neededGB,
      message: totalGB >= neededGB ? 'Sufficient storage space' : 'Insufficient storage space'
    });
  } catch (error) {
    res.status(500).json({
      success: false, message: 'Storage check failed',
    });
  }
});
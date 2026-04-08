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

app.get("/api/readiness", (req, res) => {
  exec("docker ps", (error, stdout, stderr) => {
    const dockerAvailable = !error;
    const backendAvailable = true; //backend is available if this endpoint responds
    //if backend is down then we can not confirm launch readiness
    const requiredLaunchReady = backendAvailable ? dockerAvailable : null; 
    
    res.json({
      success: true,
      backendAvailable,
      dockerAvailable,
      requiredLaunchReady,
      checks: {
        backend: {
          value: backendAvailable,
          message: backendAvailable
            ? "Backend is available"
            : "Backend is unavailable",
        },
        docker: {
          //runs "docker ps" to verify that the daemon is running
          value: dockerAvailable,
          message: dockerAvailable
            ? "Docker is reachable"
            : "Docker is unavailable",
        },
        requiredLaunch: {
          value: requiredLaunchReady,
          //null means that the backend was down so that we could not check
          message: requiredLaunchReady === null
            ? "Cannot determine launch readiness - backend unavailable"
            : requiredLaunchReady
              ? "Required launch readiness is met"
              : "Required launch readiness is not met",
        },
      },
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
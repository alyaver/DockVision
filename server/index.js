const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const checkDiskSpace = require('check-disk-space').default;
const path = require('path');
const bcrypt = require('bcryptjs');


const app = express();
const PORT = 5000;


const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
   host: process.env.EMAIL_HOST,
   port: process.env.EMAIL_PORT,
   secure: process.env.EMAIL_PORT ==465,
   auth:{
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
   }
});


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


app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
      return res.status(400).json({ message: "Email is required." });
  }
  try {
    // TODO: uncomment when database is ready
    // const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    // if (result.rows.length === 0) {
    //   return res.status(404).json({ message: "No account found with that email." });
    // }

    const resetLink = `${process.env.CLIENT_URL}/reset-password`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset",
      html: `<p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a>`,
    });

     res.status(200).json({ message: "Reset link sent." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

app.post("/api/signIn", async (req, res) => {
  console.log("Login attempt:", req.body)
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." })
  }

  // Test account - remove when DB is ready
  if (email === "test@test.com" && password === "password") {
    return res.status(200).json({
      token: "placeholder-token",
      user: { id: 0, email, name: "Test User" }
    })
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1", [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const user = result.rows[0]
    const match = await bcrypt.compare(password, user.password_hash)

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    res.status(200).json({
      token: user.token,
      user: { id: user.id, email: user.email, name: user.name }
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Server error." })
  }
})


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Backend is running' })
})

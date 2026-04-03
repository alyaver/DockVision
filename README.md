# ProjectAtlas

ProjectAtlas is a local web-based launcher for automated test sessions.  
It is being developed as a senior capstone project with a focus on practical test orchestration, container-backed execution, and a future VM-based workflow.

The current implementation provides a React frontend, an Express backend, and a root development workflow that allows the project to be launched from a single command.

---

## Overview

The goal of ProjectAtlas is to provide a simple interface for starting and monitoring automated test runs without requiring the frontend to interact with Docker or system-level tooling directly.

The system is being built around the following architecture:

1. **Frontend web application**
2. **Local backend / launcher service**
3. **Docker container execution layer**
4. **Future guest agent inside the VM / guest environment**

This keeps the UI lightweight while allowing the backend to manage container and session orchestration in a controlled way.

---

## Current Status

At the current stage of development, the project includes:

- a React + Vite frontend
- an Express backend
- a root-level development workflow using `npm run dev`
- backend Docker connectivity
- a working proof of concept for starting a smoke-test container
- a Dashboard to Confirmation flow for starting test runs

The long-term direction is to move from simple smoke-test launching toward a session-based workflow with status tracking and support for a Windows VM / guest-agent model.

---

## Tech Stack

### Frontend
- React
- Vite
- `react-router-dom`

### Backend
- Node.js
- Express
- Nodemon

### Development Workflow
- npm workspaces
- concurrently

### Container Layer
- Docker Desktop

---

## Repository Structure

```text
DockVision/
├── client/        # React + Vite frontend
├── server/        # Express backend / launcher service
├── WindowsVm/     # VM-related work and future guest-environment direction
├── package.json   # Root workspace scripts
└── README.md
```

## Getting Started
---

Prerequisites

Make sure the following are installed on your machine:

- Node.js
- npm
- Docker Desktop

Docker Desktop is required for backend routes that interact with containers.

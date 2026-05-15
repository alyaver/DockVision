<img width="1668" height="1771" alt="IMG_2252" src="https://github.com/user-attachments/assets/12a6b253-ae46-408e-861f-abcc4af330e7" />


DockVision is a local web-based launcher for automated test sessions.  
It is being developed as a senior capstone project with a focus on practical test orchestration, container-backed execution, and a future VM-based workflow.


The current implementation provides a React frontend, an Express backend, and a root development workflow that allows the project to be launched from a single command.


---


## Overview


The goal of DockVision is to provide a simple interface for starting and monitoring automated test runs without requiring the frontend to interact with Docker or system-level tooling directly.


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


## Isolated Run Storage


VM task exchange now treats `WindowsVm/shared` as a transport root instead of a single global run folder.


Each new run writes its files into:


```text
WindowsVm/shared/
  active/current-run.json
  agent-heartbeat.json
  runs/<runId>/
    meta.json
    task.json
    result.json
    logs/task.log
    screenshots/
    artifacts/
```


This prevents stale task files, screenshots, and result JSON from a previous run from being mistaken for the current run.


Cleanup rule:
- Keep the latest 20 completed or failed runs.
- Remove completed or failed runs older than 7 days.
- Apply the cleanup rule whenever a new run starts.


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
## ERD
<img width="1965" height="1468" alt="Project Atlas drawio" src="https://github.com/user-attachments/assets/bafc8bbf-7721-484b-a1de-d84597e4b8ca" />


## Screenshots


### About Page
<img width="1796" height="1687" alt="About Page" src="https://github.com/user-attachments/assets/1fd97f5a-a853-4499-aadc-6f1e4a0284c8" />


### Dashboard
<img width="1299" height="1921" alt="Dashboard" src="https://github.com/user-attachments/assets/714ab471-e736-4248-82d6-229b7fc4939b" />


### Running Test Page
 <img width="876" height="1079" alt="running_test2" src="https://github.com/user-attachments/assets/d071d1f1-0f21-47f4-ada2-b259dbe4a869" />

### VM Screenshot of a test run
<img width="1280" height="720" alt="notepadVM" src="https://github.com/user-attachments/assets/8901f3ba-397b-486b-805a-64507f25b437" />




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


Install the following before you start:


- Node.js
- npm
- Docker Desktop


PostgreSQL is required for authentication and session storage.
Docker Desktop is required for Docker-backed run and Windows VM routes.


### 1. Install dependencies


From the repository root, install all workspace dependencies:


```powershell
npm install
```


### 2. Configure the server environment


Create a local server environment file from the example:


```powershell
Copy-Item server/.env.example server/.env
```
Then open `server/.env` and set the database values for your local PostgreSQL instance:


```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=postgres
```
The email settings in `server/.env.example` are optional. You only need them if you want forgot-password emails to send from your machine.


### 3. Create the database tables


Run the schema file against the same database you configured




### 4. Start the development servers


From the repository root, run:


```powershell
npm run dev
```


This starts:
the frontend at `http://localhost:5173`
the backend at `http://localhost:5000`


If you are on Windows and want the client and server opened in separate terminal tabs, you can also use:
 
```powershell
.\launch.ps1
```


### 5. Open the app




Open `http://localhost:5173`
In your browser.


If everything is running correctly:


the frontend should load at `http://localhost:5173`
the backend health check should respond at `http://localhost:5000/api/health`


### First-Run Notes


- Start Docker Desktop before using test-run, container, or Windows VM routes.
- If registration or login fails on a new setup, make sure PostgreSQL is running and that `server/db/schema.sql` has been applied.
- Forgot-password requests will return a configuration message until the optional `EMAIL_*` values are set.






## What’s Coming
- Sprint 5 (31 August - 13 September) - Prepare for testing/”Taskifying” script
- Sprint 6 (14 September - 27 September)- “Taskifying” a script for users
- Sprint 7 (28 September - 11 October) -  Finalize “Taskifying” a script for users
  - Create a GUI layer that allows user to select a series of tasks to be performed, in a specific order. Then it generates the script + config file for the user to run
- Sprint 8 (12 October - 25 October) - Improve UI for a better user experience
- Sprint 9 (26 October - 9 November) - Project ready for deployment






## Testing
TBD


## Deployment
TBD


## Developer Instructions
TBD


## License
Raeshon Minifield, Anton Lyaver, Mike Normile, Johnathan Castaneda, Dann Manganti, Brendan Nichols, Caleb Lewis, and Ashanti Momon maintain nominal ownership of the software, and the Product Owner will receive all specified documentation along with the software, including both source and executable code. Also, the CSUS Computer Science Department reserves the right to use the documentation and product as examples of student work.

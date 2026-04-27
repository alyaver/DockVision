const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Normalize backend failures into a single thrown Error so pages can stay
// focused on UX instead of repeating response parsing and fallback logic.
async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data; 
}

// The backend owns the decision of whether a run needs to cold-start the
// Windows guest or can reuse the existing one, so the client only sends the
// run payload and consumes the normalized response.
export async function startTestRun(payload = {}) {
  const response = await fetch(`${API_BASE}/api/runs/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson(response);
}

// Expose direct Windows guest controls for readiness views and manual recovery.
export async function startWindowsVm() {
  const response = await fetch(`${API_BASE}/api/windows-vm/start`, {
    method: "POST",
  });

  return parseJson(response);
}

export async function getWindowsVmStatus() {
  const response = await fetch(`${API_BASE}/api/windows-vm/status`);
  return parseJson(response);
}

// Preserve the previous helper name while callers migrate to the real intent.
export const startSmokeContainer = startTestRun;

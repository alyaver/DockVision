const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Normalize backend failures into a single thrown Error so pages can stay
// focused on UX instead of repeating response parsing and fallback logic.
async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || data.error || "Request failed");
    error.status = response.status;
    error.code = data.code;
    error.activeRunId = data.activeRunId;
    error.fieldErrors = data.fieldErrors;
    throw error;
  }

  return data; 
}

// The backend owns the decision of whether a run needs to cold-start the
// Windows guest or can reuse the existing one, so the client only sends the
// run payload and consumes the normalized response.
export async function startTestRun(payload = {}, { signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
  const response = await fetch(`${API_BASE}/api/runs/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  return await parseJson(response);
  } catch (error) {
    if (signal?.aborted || error.status) throw error;
    throw new Error("Lost contact with the DockVision backend or the request timed out. Acceptance could not be confirmed. Check the backend and existing run status before retrying; this request will not be automatically resent.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function getRun(runId) {
  const response = await fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}`);

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || data?.error || "Failed to load run status.";
    throw new Error(message);
  }

  return data;
}

export async function cancelRun(runId) {
  const response = await fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || "Failed to request cancellation."
    );
    error.status = response.status;
    throw error;
  }

  return data;
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data; 

}

export async function startSmokeContainer() {
  const response = await fetch(`${API_BASE}/api/docker/start-smoke`, {
    method: "POST",
  });

  return parseJson(response);
}
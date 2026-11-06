export const CURRENT_RUN_STORAGE_KEY = "dockvision-current-run";

export function clearStoredRunIfMatches(storage, runId) {
  if (!storage || !runId) {
    return false;
  }

  try {
    const rawValue = storage.getItem(CURRENT_RUN_STORAGE_KEY);
    const storedRun = rawValue ? JSON.parse(rawValue) : null;
    if (storedRun?.runId !== runId) {
      return false;
    }

    storage.removeItem(CURRENT_RUN_STORAGE_KEY);
    return true;
  } catch {
    storage.removeItem(CURRENT_RUN_STORAGE_KEY);
    return true;
  }
}
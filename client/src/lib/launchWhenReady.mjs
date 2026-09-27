const waitingMessages = {
  GUEST_STARTING: "Starting Windows. Your test will start automatically when the test agent is ready.",
  GUEST_NOT_READY: "Waiting for Windows to become ready…",
  AGENT_NOT_READY: "Waiting for the Windows test agent to connect and become idle…",
};

// Retry only explicit non-admission responses. Never retry an uncertain network failure.
export async function launchWhenReady(payload, {
  launch, onProgress = () => {}, signal, timeoutMs = 300000,
  intervalMs = 3000, now = Date.now,
  sleep = (ms) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped waiting", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  }),
}) {
  const deadline = now() + timeoutMs;
  onProgress("Checking Windows and preparing your test…");
  while (now() < deadline) {
    signal?.throwIfAborted();
    try {
      return await launch(payload, { signal, timeoutMs: Math.min(30000, deadline - now()) });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error.status !== 409 || !waitingMessages[error.code]) throw error;
      const elapsed = Math.floor((timeoutMs - Math.max(0, deadline - now())) / 1000);
      onProgress(`${waitingMessages[error.code]} (${elapsed}s elapsed; up to five minutes.)`);
      await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
    }
  }
  throw new Error("Windows did not become ready within five minutes. No test was queued by these readiness checks. Open the VM desktop and check that the DockVision agent is running, then retry. Your uploaded files are still here.");
}
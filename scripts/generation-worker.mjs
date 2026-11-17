import { setTimeout } from "node:timers/promises";

// Enable explicitly; this worker needs no database or AI provider key.
const baseUrl = process.env.GENERATION_WORKER_BASE_URL ||
  (process.env.GENERATION_WORKER_HOSTPORT ? `http://${process.env.GENERATION_WORKER_HOSTPORT}` : "http://postalk-web:3000");
const enabled = process.env.GENERATION_WORKER_ENABLED === "true";
const key = process.env.INTERNAL_WORKER_API_KEY?.trim();
if (enabled && !key) throw new Error("INTERNAL_WORKER_API_KEY is required for the generation worker");
console.log(enabled ? "Generation recovery worker started" : "Generation recovery is disabled; no external jobs will run.");
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown.abort());
let reportedCheck = false;

while (!shutdown.signal.aborted) {
  try {
    if (enabled) {
      const response = await fetch(new URL("/api/internal/generation-jobs/recover", baseUrl), {
        method: "POST",
        headers: { "x-internal-worker-key": key },
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30 * 60_000)]),
      });
      if (!response.ok) throw new Error(`Recovery endpoint returned ${response.status}`);
      const payload = await response.json();
      if (payload.success !== true || !Array.isArray(payload.data?.results)) throw new Error("Recovery endpoint returned an invalid result");
      const results = payload.data.results;
      if (!reportedCheck || results.length) {
        console.log("Generation recovery checked", JSON.stringify({
          checked: results.length,
          completed: results.filter(result => result.status === "completed").length,
          errors: results.filter(result => result.status === "error").length,
        }));
        reportedCheck = true;
      }
      if (results.some(result => result.status === "error")) console.error("Some generation jobs could not be recovered");
    }
  } catch (error) {
    if (!shutdown.signal.aborted) console.error("Generation worker request failed:", error.message);
  }
  await setTimeout(20_000, undefined, { signal: shutdown.signal }).catch(() => {});
}

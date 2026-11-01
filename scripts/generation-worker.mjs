import { setTimeout } from "node:timers/promises";

const baseUrl = process.env.GENERATION_WORKER_BASE_URL || "http://postalk-web:3000";
const key = process.env.INTERNAL_WORKER_API_KEY?.trim();
if (!key) throw new Error("INTERNAL_WORKER_API_KEY is required for the generation worker");
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown.abort());

while (!shutdown.signal.aborted) {
  try {
    const response = await fetch(new URL("/api/internal/generation-jobs/recover", baseUrl), {
      method: "POST",
      headers: { "x-internal-worker-key": key },
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30 * 60_000)]),
    });
    if (!response.ok) throw new Error(`Recovery endpoint returned ${response.status}`);
    const payload = await response.json();
    if (payload.data?.results?.some(result => result.status === "error")) console.error("Some generation jobs could not be recovered");
  } catch (error) {
    if (!shutdown.signal.aborted) console.error("Generation worker request failed:", error.message);
  }
  await setTimeout(20_000, undefined, { signal: shutdown.signal }).catch(() => {});
}

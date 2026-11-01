export function resolveDurationSeconds(body: { durationSeconds?: number | null; durationMs?: number | null }) {
  if (typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds) && body.durationSeconds > 0) {
    return body.durationSeconds;
  }
  if (typeof body.durationMs === "number" && Number.isFinite(body.durationMs) && body.durationMs > 0) {
    return body.durationMs / 1000;
  }
  return null;
}

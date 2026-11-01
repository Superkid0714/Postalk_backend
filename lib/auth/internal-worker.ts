import { timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/api/response";
import { getInternalWorkerApiKey } from "@/lib/env";

export function requireInternalWorkerKey(request: Request) {
  const configured = getInternalWorkerApiKey();
  if (!configured) return errorResponse("Internal worker is not configured", 503, { code: "WORKER_NOT_CONFIGURED" });
  const provided = request.headers.get("x-internal-worker-key");
  if (!provided) return errorResponse("Unauthorized", 401, { code: "UNAUTHORIZED" });
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return errorResponse("Unauthorized", 401, { code: "UNAUTHORIZED" });
  }
  return null;
}

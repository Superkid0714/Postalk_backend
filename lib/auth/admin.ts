import type { NextRequest } from "next/server";

import { errorResponse } from "@/lib/api/response";
import { getAdminApiKey } from "@/lib/env";

export function requireAdminApiKey(request: NextRequest) {
  const configuredKey = getAdminApiKey();

  if (!configuredKey) {
    return {
      ok: false as const,
      response: errorResponse("ADMIN_API_KEY is not configured", 500, {
        code: "ADMIN_KEY_NOT_CONFIGURED",
      }),
    };
  }

  const providedKey = request.headers.get("x-admin-key");

  if (!providedKey || providedKey !== configuredKey) {
    return {
      ok: false as const,
      response: errorResponse("Invalid admin credentials", 401, {
        code: "UNAUTHORIZED",
      }),
    };
  }

  return {
    ok: true as const,
  };
}

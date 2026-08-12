import type { NextRequest } from "next/server";

import { errorResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/validation";

export function getRequestUserId(request: NextRequest) {
  const userId = request.headers.get("x-user-id");

  if (!userId) {
    return {
      ok: false as const,
      response: errorResponse("Missing x-user-id header", 401, {
        code: "UNAUTHORIZED",
      }),
    };
  }

  if (!isUuid(userId)) {
    return {
      ok: false as const,
      response: errorResponse("Invalid x-user-id header", 400, {
        code: "VALIDATION_ERROR",
        details: [
          {
            field: "x-user-id",
            reason: "Must be a valid UUID",
          },
        ],
      }),
    };
  }

  return {
    ok: true as const,
    userId,
  };
}

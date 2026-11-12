import { errorResponse, successResponse } from "@/lib/api/response";
import { readRequestBody } from "@/lib/api/request-body";
import { GUEST_SESSION_HEADER, guestCreationEnabled, guestSessionHash, openGuestStore } from "@/lib/auth/guest-session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  if (!guestCreationEnabled()) {
    return errorResponse("Guest creation is disabled", 404, { code: "NOT_FOUND" });
  }

  const hash = guestSessionHash(request.headers.get(GUEST_SESSION_HEADER) ?? "");
  if (!hash) {
    return errorResponse("A valid guest session key is required", 400, { code: "VALIDATION_ERROR" });
  }

  let storeName: string | undefined;
  let marketName: string | undefined;
  try {
    const body = request.body ? await readRequestBody(request) : {};
    storeName = typeof body.storeName === "string" ? body.storeName.trim() : undefined;
    marketName = typeof body.marketName === "string" ? body.marketName.trim() : undefined;
    if ([storeName, marketName].some(name => name !== undefined && (!name || name.length > 100))) {
      throw new Error("Invalid workspace name");
    }
  } catch {
    return errorResponse("Enter a valid store or market name", 400, { code: "VALIDATION_ERROR" });
  }

  const { data, error } = await openGuestStore(getSupabaseServiceClient(), hash, { storeName, marketName });
  if (error || !data) {
    return errorResponse("Unable to open a guest workspace", 503, { code: "AUTH_UNAVAILABLE" });
  }
  const response = successResponse({ storeId: data.id, canPublish: false });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

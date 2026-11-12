import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse } from "@/lib/api/response";
import { findGuestStore, GUEST_SESSION_HEADER, guestCreationEnabled, guestSessionHash } from "@/lib/auth/guest-session";
import { resolveActivatedStoreFromQrToken } from "@/lib/merchant-qr";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Resource = { storeId: string } | { submissionId: string } | { jobId: string } | { sessionId: string };

export async function requireMerchantStoreAccess(request: Request, resource: Resource) {
  if (request.headers.has(GUEST_SESSION_HEADER)) {
    return errorResponse("Guest sessions cannot perform this operation", 403, { code: "FORBIDDEN" });
  }
  return requireStoreAccess(request, resource);
}

export async function requireStoreAccess(
  request: Request,
  resource: Resource,
  bodyQrToken?: string,
  client?: SupabaseClient,
) {
  const guestToken = request.headers.get(GUEST_SESSION_HEADER);
  const qrToken = request.headers.get("x-merchant-qr-token")?.trim() || bodyQrToken?.trim() || "";
  const hash = guestToken !== null && guestCreationEnabled() ? guestSessionHash(guestToken) : null;
  if ((guestToken !== null && !hash) || (!hash && !qrToken)) {
    return errorResponse("Valid store credentials are required", 401, { code: "UNAUTHORIZED" });
  }

  const supabase = client ?? getSupabaseServiceClient();
  const access = hash
    ? await findGuestStore(supabase, hash)
    : await resolveActivatedStoreFromQrToken(supabase, qrToken)
      .then(({ store, error }) => ({ data: store, error }));
  if (access.error) return errorResponse("Unable to verify store credentials", 503, { code: "AUTH_UNAVAILABLE" });
  if (!access.data) return errorResponse("Invalid or inactive store credentials", 401, { code: "UNAUTHORIZED" });

  let storeId: string;
  if ("storeId" in resource) {
    storeId = resource.storeId;
  } else {
    const [table, id] = "submissionId" in resource
      ? ["submissions", resource.submissionId]
      : "jobId" in resource
        ? ["generation_jobs", resource.jobId]
        : ["ad_creation_sessions", resource.sessionId];
    const { data, error } = await supabase.from(table).select("store_id").eq("id", id).maybeSingle();
    if (error) return errorResponse("Unable to verify resource access", 503, { code: "AUTH_UNAVAILABLE" });
    if (!data && "jobId" in resource) {
      // Older video mock jobs may exist only in the submission workflow.
      // Restrict the lookup to the authenticated merchant before searching.
      const { data: legacy, error: legacyError } = await supabase.from("submissions")
        .select("store_id").eq("store_id", access.data.id)
        .or(`ai_metadata->videoWorkflow->>currentJobId.eq.${id},ai_metadata->videoWorkflow->>lastCompletedJobId.eq.${id}`)
        .limit(1).maybeSingle();
      if (legacyError) return errorResponse("Unable to verify resource access", 503, { code: "AUTH_UNAVAILABLE" });
      if (!legacy) return errorResponse("Resource not found", 404, { code: "NOT_FOUND" });
      storeId = legacy.store_id;
    } else {
      if (!data) return errorResponse("Resource not found", 404, { code: "NOT_FOUND" });
      storeId = data.store_id;
    }
  }
  return storeId === access.data.id ? null : errorResponse("Access denied for this store", 403, { code: "FORBIDDEN" });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse } from "@/lib/api/response";
import { resolveActivatedStoreFromQrToken } from "@/lib/merchant-qr";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Resource = { storeId: string } | { submissionId: string } | { jobId: string } | { sessionId: string };

export async function requireStoreAccess(
  request: Request,
  resource: Resource,
  bodyQrToken?: string,
  client?: SupabaseClient,
) {
  const token = request.headers.get("x-merchant-qr-token")?.trim() || bodyQrToken?.trim();
  if (!token) return errorResponse("Merchant QR credentials are required", 401, { code: "UNAUTHORIZED" });
  const supabase = client ?? getSupabaseServiceClient();
  const merchant = await resolveActivatedStoreFromQrToken(supabase, token);
  if (merchant.error) return errorResponse("Unable to verify merchant credentials", 503, { code: "AUTH_UNAVAILABLE" });
  if (!merchant.store) return errorResponse("Invalid or inactive merchant QR", 401, { code: "UNAUTHORIZED" });

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
        .select("store_id").eq("store_id", merchant.store.id)
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
  return storeId === merchant.store.id ? null : errorResponse("Access denied for this store", 403, { code: "FORBIDDEN" });
}

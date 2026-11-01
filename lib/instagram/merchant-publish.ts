import { readRequestBody } from "@/lib/api/request-body";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireStoreAccess } from "@/lib/auth/store-access";
import { isUuid } from "@/lib/validation";
import { isInstagramConfigured, startInstagramPublishForSubmission } from "@/lib/instagram/publish";
import { PublishBusyError } from "@/lib/instagram/publish-lock";

export async function handleMerchantPublish(request: Request, submissionId?: string, mediaType?: "photo" | "video") {
  let body: Record<string, unknown>;
  try { body = request.body ? await readRequestBody(request) : {}; }
  catch { return errorResponse("Invalid JSON body", 400, { code: "VALIDATION_ERROR" }); }
  const id = submissionId ?? body.submissionId;
  if (!isUuid(id)) return errorResponse("Invalid submissionId", 400, { code: "VALIDATION_ERROR" });
  const selectedType = mediaType ?? body.mediaType;
  if (selectedType !== undefined && selectedType !== "photo" && selectedType !== "video") {
    return errorResponse("mediaType must be photo or video", 400, { code: "VALIDATION_ERROR" });
  }
  const accessError = await requireStoreAccess(request, { submissionId: id });
  if (accessError) return accessError;
  if (!isInstagramConfigured()) return errorResponse("Instagram publishing is not configured", 503, { code: "INSTAGRAM_NOT_CONFIGURED" });
  try {
    const result = await startInstagramPublishForSubmission(id, {
      mediaType: selectedType,
      captionOverride: typeof body.captionOverride === "string" ? body.captionOverride : undefined,
    });
    if (!result.ok) return errorResponse("Instagram publish failed", 502, { code: "INSTAGRAM_PUBLISH_FAILED" });
    return successResponse(result, result.status === "published" ? "Instagram post already published" : "Instagram publishing started", result.status === "processing" ? 202 : 200);
  } catch (error) {
    if (error instanceof PublishBusyError) return errorResponse(error.message, 409, { code: "PUBLISH_IN_PROGRESS" });
    console.error("Merchant publish failed", { submissionId: id, error });
    return errorResponse("Unable to publish this submission", 502, { code: "INSTAGRAM_PUBLISH_FAILED" });
  }
}

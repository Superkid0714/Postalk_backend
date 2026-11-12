import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMerchantStoreAccess } from "@/lib/auth/store-access";
import { isInstagramConfigured, syncInstagramPublishForSubmission } from "@/lib/instagram/publish";
import { PublishBusyError } from "@/lib/instagram/publish-lock";
import { isUuid } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

/**
 * Checks one merchant-owned Instagram container and publishes it once ready.
 * This keeps a merchant-driven publish flow usable when the background worker
 * is intentionally disabled.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid submission id", 400, { code: "VALIDATION_ERROR" });
  }

  const accessError = await requireMerchantStoreAccess(request, { submissionId: id });
  if (accessError) return accessError;

  if (!isInstagramConfigured()) {
    return errorResponse("Instagram publishing is not configured", 503, { code: "INSTAGRAM_NOT_CONFIGURED" });
  }

  try {
    const result = await syncInstagramPublishForSubmission(id);
    if (!result.ok) {
      return errorResponse("Instagram publish failed", 502, { code: "INSTAGRAM_PUBLISH_FAILED" });
    }

    return successResponse(
      result,
      result.status === "published" ? "Instagram post published" : "Instagram is still processing",
      result.status === "processing" ? 202 : 200,
    );
  } catch (error) {
    if (error instanceof PublishBusyError) {
      return errorResponse(error.message, 409, { code: "PUBLISH_IN_PROGRESS" });
    }

    console.error("Merchant Instagram publish sync failed", { submissionId: id, error });
    return errorResponse("Unable to synchronize Instagram publish", 502, { code: "INSTAGRAM_PUBLISH_FAILED" });
  }
}

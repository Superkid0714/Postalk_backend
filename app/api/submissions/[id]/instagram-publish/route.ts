import { handleMerchantPublish } from "@/lib/instagram/merchant-publish";
import { getStoredInstagramPublishForSubmission } from "@/lib/instagram/publish";
import { requireStoreAccess } from "@/lib/auth/store-access";
import { isUuid } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api/response";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleMerchantPublish(request, (await context.params).id);
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("Invalid submission id", 400, { code: "VALIDATION_ERROR" });
  const accessError = await requireStoreAccess(request, { submissionId: id });
  if (accessError) return accessError;
  try { return successResponse(await getStoredInstagramPublishForSubmission(id)); }
  catch { return errorResponse("Publish state not found", 404, { code: "PUBLISH_NOT_FOUND" }); }
}

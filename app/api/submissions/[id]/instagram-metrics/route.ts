import { getStoredInstagramMetricsForSubmission, refreshInstagramMetricsForSubmission } from "@/lib/instagram/metrics";
import { requireStoreAccess } from "@/lib/auth/store-access";
import { isUuid } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api/response";

type Context = { params: Promise<{ id: string }> };

async function metrics(request: Request, context: Context, refresh: boolean) {
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("Invalid submission id", 400, { code: "VALIDATION_ERROR" });
  const accessError = await requireStoreAccess(request, { submissionId: id });
  if (accessError) return accessError;
  try { return successResponse(await (refresh ? refreshInstagramMetricsForSubmission(id) : getStoredInstagramMetricsForSubmission(id))); }
  catch { return errorResponse("Unable to load Instagram metrics", 502, { code: "INSTAGRAM_METRICS_FAILED" }); }
}

export async function GET(request: Request, context: Context) { return metrics(request, context, false); }
export async function POST(request: Request, context: Context) { return metrics(request, context, true); }

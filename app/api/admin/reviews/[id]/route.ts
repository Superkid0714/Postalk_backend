import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildReviewDetail,
  type ReviewSubmissionRecord,
} from "@/lib/admin-review";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const request = _request;
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid review id", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "id", reason: "id must be a valid UUID" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(
      `
        id,
        submitter_name,
        submitter_affiliation,
        title,
        target_menu_name,
        status,
        created_at,
        updated_at,
        store_type,
        price_text,
        appeal_point,
        extra_message,
        caption,
        hashtags,
        ai_metadata,
        admin_notes,
        reviewed_by,
        reviewed_at,
        stores (
          id,
          market_name,
          store_name,
          owner_name
        ),
        submission_assets (
          asset_type,
          storage_bucket,
          file_path,
          file_name,
          mime_type,
          file_size,
          created_at,
          sort_order
        )
      `,
    )
    .eq("id", id)
    .single<ReviewSubmissionRecord>();

  if (error || !data) {
    return errorResponse("Review detail not found", 404, {
      code: "ADMIN_REVIEW_NOT_FOUND",
    });
  }

  const detail = await buildReviewDetail(data);

  return successResponse(detail, "Review detail loaded");
}

import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const ALLOWED_STATUSES = ["pending_review", "approved", "rejected"] as const;

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const status = request.nextUrl.searchParams.get("status");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit =
    typeof limitParam === "string" && Number.isFinite(Number(limitParam))
      ? Math.min(Math.max(Number(limitParam), 1), 100)
      : 20;

  if (status && !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
    return errorResponse("Invalid status filter", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "status", reason: "Unsupported status value" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("submissions")
    .select(
      `
        id,
        submitter_name,
        submitter_affiliation,
        store_type,
        target_menu_name,
        price_text,
        appeal_point,
        extra_message,
        title,
        caption,
        hashtags,
        transcript,
        ai_metadata,
        status,
        admin_notes,
        reviewed_by,
        reviewed_at,
        created_at,
        stores (
          id,
          market_name,
          store_name
        ),
        submission_assets (
          id,
          asset_type,
          storage_bucket,
          file_path,
          file_name,
          mime_type,
          file_size,
          sort_order
        )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return errorResponse("Failed to fetch submissions", 500, {
      code: "SUBMISSION_LIST_FAILED",
      details: error.message,
    });
  }

  return successResponse(
    {
      items: data ?? [],
      count: data?.length ?? 0,
    },
    "Submission list loaded",
  );
}

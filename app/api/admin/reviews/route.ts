import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildReviewListItem,
  type ReviewSubmissionRecord,
} from "@/lib/admin-review";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const REVIEW_STATUSES = ["pending_review", "approved", "rejected"] as const;

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const status = request.nextUrl.searchParams.get("status");
  const marketName = request.nextUrl.searchParams.get("marketName")?.trim() || null;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit =
    typeof limitParam === "string" && Number.isFinite(Number(limitParam))
      ? Math.min(Math.max(Number(limitParam), 1), 50)
      : 20;

  if (
    status &&
    !REVIEW_STATUSES.includes(status as (typeof REVIEW_STATUSES)[number])
  ) {
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
        title,
        target_menu_name,
        status,
        created_at,
        updated_at,
        stores!inner (
          id,
          market_name,
          store_name
        ),
        submission_assets (
          asset_type,
          storage_bucket,
          file_path,
          sort_order
        )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  if (marketName) {
    query = query.eq("stores.market_name", marketName);
  }

  const { data, error } = await query.returns<ReviewSubmissionRecord[]>();

  if (error) {
    return errorResponse("Failed to load review list", 500, {
      code: "ADMIN_REVIEW_LIST_FAILED",
      details: error.message,
    });
  }

  const items = await Promise.all((data ?? []).map(buildReviewListItem));

  return successResponse(
    {
      items,
      count: items.length,
    },
    "Review list loaded",
  );
}

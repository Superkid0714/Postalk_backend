import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type UpdateSubmissionBody = {
  status?: "pending_review" | "approved" | "rejected";
  storeType?: string;
  targetMenuName?: string;
  priceText?: string;
  appealPoint?: string;
  extraMessage?: string;
  caption?: string;
  hashtags?: string[];
  adminNotes?: string;
  reviewedBy?: string;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/admin/submissions/[id]">,
) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid submission id", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "id", reason: "id must be a valid UUID" }],
    });
  }

  let body: UpdateSubmissionBody;

  try {
    body = (await request.json()) as UpdateSubmissionBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const updates: Record<string, unknown> = {};

  if (body.status) {
    updates.status = body.status;
  }

  if (typeof body.storeType === "string") {
    updates.store_type = body.storeType.trim();
  }

  if (typeof body.targetMenuName === "string") {
    updates.target_menu_name = body.targetMenuName.trim();
  }

  if (typeof body.priceText === "string") {
    updates.price_text = body.priceText.trim();
  }

  if (typeof body.appealPoint === "string") {
    updates.appeal_point = body.appealPoint.trim();
  }

  if (typeof body.extraMessage === "string") {
    updates.extra_message = body.extraMessage.trim();
  }

  if (typeof body.caption === "string") {
    updates.caption = body.caption.trim();
  }

  if (Array.isArray(body.hashtags)) {
    updates.hashtags = body.hashtags;
  }

  if (typeof body.adminNotes === "string") {
    updates.admin_notes = body.adminNotes.trim();
  }

  if (typeof body.reviewedBy === "string") {
    updates.reviewed_by = body.reviewedBy.trim();
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse("No fields to update", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if ("status" in updates) {
    updates.reviewed_at = new Date().toISOString();
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("submissions")
    .update(updates)
    .eq("id", id)
    .select(
      `
        id,
        status,
        store_type,
        target_menu_name,
        price_text,
        appeal_point,
        extra_message,
        caption,
        hashtags,
        admin_notes,
        reviewed_by,
        reviewed_at,
        updated_at
      `,
    )
    .single();

  if (error || !data) {
    return errorResponse("Failed to update submission", 500, {
      code: "SUBMISSION_UPDATE_FAILED",
      details: error?.message,
    });
  }

  return successResponse(data, "Submission updated");
}

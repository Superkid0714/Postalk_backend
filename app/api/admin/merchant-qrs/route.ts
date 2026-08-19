import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildMerchantQrToken,
  loadMerchantQrStore,
  mapMerchantQrResponse,
  type MerchantQrRecord,
  type MerchantQrStatus,
} from "@/lib/merchant-qr";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateMerchantQrBody = {
  count?: number;
};

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const status = request.nextUrl.searchParams.get("status")?.trim() as
    | MerchantQrStatus
    | undefined;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit =
    typeof limitParam === "string" && Number.isFinite(Number(limitParam))
      ? Math.min(Math.max(Number(limitParam), 1), 100)
      : 50;

  if (status && !["ready", "activated", "disabled"].includes(status)) {
    return errorResponse("Invalid status", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "status", reason: "status must be ready, activated, or disabled" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("merchant_qr_tokens")
    .select(
      "id, qr_token, status, assigned_store_id, assigned_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data: qrs, error } = await query.returns<MerchantQrRecord[]>();

  if (error) {
    return errorResponse("Failed to load merchant QRs", 500, {
      code: "MERCHANT_QR_LIST_FAILED",
      details: error.message,
    });
  }

  const origin = request.nextUrl.origin;
  const items = await Promise.all(
    (qrs ?? []).map(async (qr) => {
      const { data: store } = await loadMerchantQrStore(
        supabase,
        qr.assigned_store_id,
      );

      return mapMerchantQrResponse(qr, origin, store);
    }),
  );

  return successResponse(
    {
      items,
      count: items.length,
    },
    "Merchant QR list loaded",
  );
}

export async function POST(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  let body: CreateMerchantQrBody = {};

  try {
    body = (await request.json()) as CreateMerchantQrBody;
  } catch {
    body = {};
  }

  const count =
    typeof body.count === "number" && Number.isFinite(body.count)
      ? Math.min(Math.max(Math.trunc(body.count), 1), 20)
      : 1;

  const rows = Array.from({ length: count }, () => ({
    qr_token: buildMerchantQrToken(),
    status: "ready" as const,
  }));

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("merchant_qr_tokens")
    .insert(rows)
    .select(
      "id, qr_token, status, assigned_store_id, assigned_at, created_at, updated_at",
    )
    .returns<MerchantQrRecord[]>();

  if (error) {
    return errorResponse("Failed to create merchant QR", 500, {
      code: "MERCHANT_QR_CREATE_FAILED",
      details: error.message,
    });
  }

  const origin = request.nextUrl.origin;

  return successResponse(
    {
      items: (data ?? []).map((qr) => mapMerchantQrResponse(qr, origin)),
      count: data?.length ?? 0,
    },
    "Merchant QR created",
    201,
  );
}

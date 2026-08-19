import type { NextRequest } from "next/server";

import QRCode from "qrcode";

import { errorResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildQrEntryUrl,
  buildQrSlotLabel,
  type QrSlotRecord,
  type StoreSummary,
} from "@/lib/qr/slots";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPrintHtml(params: {
  store: StoreSummary;
  qr: QrSlotRecord & { qrSvg: string; qrValue: string };
}) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(params.store.store_name)} QR 출력</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        font-family: Arial, sans-serif;
        color: #1f1f1f;
        background: #f6f4ff;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      .subtitle {
        margin: 0 0 24px;
        color: #555;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 20px;
      }
      .card {
        background: white;
        border: 2px solid #d9d2ff;
        border-radius: 18px;
        padding: 20px;
        min-height: 520px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
      }
      .meta {
        text-align: center;
        margin-bottom: 16px;
      }
      .market {
        font-size: 14px;
        color: #7165b5;
        margin-bottom: 4px;
      }
      .store {
        font-size: 22px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .label {
        display: inline-block;
        padding: 6px 12px;
        border-radius: 999px;
        background: #efeaff;
        color: #5d50a5;
        font-size: 13px;
        font-weight: 700;
      }
      .qr svg {
        width: 240px;
        height: 240px;
      }
      .code {
        margin-top: 14px;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        word-break: break-all;
      }
      .url {
        margin-top: 8px;
        font-size: 11px;
        color: #666;
        text-align: center;
        word-break: break-all;
      }
      @media print {
        body {
          padding: 0;
          background: white;
        }
        .grid {
          gap: 12px;
        }
        .card {
          break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(params.store.store_name)} 상인 QR 출력</h1>
    <p class="subtitle">${escapeHtml(params.store.market_name)} · 상인당 1개 QR</p>
    <main class="grid">
      <section class="card">
        <div class="meta">
          <div class="market">${escapeHtml(params.store.market_name)}</div>
          <div class="store">${escapeHtml(params.store.store_name)}</div>
          <div class="label">${escapeHtml(buildQrSlotLabel())}</div>
        </div>
        <div class="qr">${params.qr.qrSvg}</div>
        <div class="code">${escapeHtml(params.qr.slot_key)}</div>
        <div class="url">${escapeHtml(params.qr.qrValue)}</div>
      </section>
    </main>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const storeId = request.nextUrl.searchParams.get("storeId")?.trim();

  if (!storeId) {
    return errorResponse("storeId is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId is required" }],
    });
  }

  if (!isUuid(storeId)) {
    return errorResponse("Invalid storeId", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId must be a valid UUID" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, market_name, store_name")
    .eq("id", storeId)
    .single<StoreSummary>();

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
      details: storeError?.message,
    });
  }

  const { data: qr, error: qrError } = await supabase
    .from("qr_entry_slots")
    .select(
      "id, store_id, slot_number, slot_key, label, is_active, metadata, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .limit(1)
    .maybeSingle<QrSlotRecord>();

  if (qrError) {
    return errorResponse("Failed to load merchant QR", 500, {
      code: "MERCHANT_QR_LOAD_FAILED",
      details: qrError.message,
    });
  }

  if (!qr) {
    return errorResponse("Merchant QR not found for store", 404, {
      code: "MERCHANT_QR_NOT_FOUND",
    });
  }

  const qrValue = buildQrEntryUrl(request.nextUrl.origin, qr.slot_key);
  const qrSvg = await QRCode.toString(qrValue, {
    type: "svg",
    margin: 1,
    width: 512,
    color: {
      dark: "#1f1f1f",
      light: "#ffffff",
    },
  });

  const html = buildPrintHtml({
    store,
    qr: {
      ...qr,
      qrSvg,
      qrValue,
    },
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

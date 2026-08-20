import { after } from "next/server";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSessionSummary,
  buildSessionWorkflowSeed,
  getDefaultSessionCategory,
  getRequestedShot,
} from "@/lib/ad-session";
import { prepareAdSessionDrafts } from "@/lib/ad-session-preparation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type StartAdSessionBody = {
  storeId?: string;
  adType?: "photo" | "video";
  menuIntro?: string;
  storeSpecialty?: string;
  introText?: string;
};

function buildCombinedIntroText(body: StartAdSessionBody) {
  if (body.introText?.trim()) {
    return body.introText.trim();
  }

  const menuIntro = body.menuIntro?.trim();
  const storeSpecialty = body.storeSpecialty?.trim();

  return [
    menuIntro ? `주력 메뉴를 포함한 대표 메뉴 소개: ${menuIntro}` : null,
    storeSpecialty ? `가게만의 특별함: ${storeSpecialty}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export async function POST(request: NextRequest) {
  let body: StartAdSessionBody;

  try {
    body = (await request.json()) as StartAdSessionBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const details: Array<{ field: string; reason: string }> = [];
  const combinedIntroText = buildCombinedIntroText(body);

  if (!body.storeId || !isUuid(body.storeId)) {
    details.push({
      field: "storeId",
      reason: "storeId must be a valid UUID",
    });
  }

  if (body.adType !== "photo" && body.adType !== "video") {
    details.push({
      field: "adType",
      reason: "adType must be either photo or video",
    });
  }

  if (body.introText?.trim()) {
    // Legacy fallback for older clients.
  } else {
    if (!body.menuIntro?.trim()) {
      details.push({
        field: "menuIntro",
        reason: "menuIntro is required",
      });
    }

    if (!body.storeSpecialty?.trim()) {
      details.push({
        field: "storeSpecialty",
        reason: "storeSpecialty is required",
      });
    }
  }

  if (!combinedIntroText) {
    details.push({
      field: "intro",
      reason: "menuIntro and storeSpecialty are required",
    });
  }

  if (details.length > 0) {
    return errorResponse("Invalid request body", 400, {
      code: "VALIDATION_ERROR",
      details,
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, market_name, store_name, owner_name, category, description, location_address")
    .eq("id", body.storeId)
    .single();

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const workflow = buildSessionWorkflowSeed(combinedIntroText, {
    adType: body.adType,
    menuIntro: body.menuIntro?.trim() ?? null,
    storeSpecialty: body.storeSpecialty?.trim() ?? null,
  });
  const category = getDefaultSessionCategory(store.category);
  const firstRequest = getRequestedShot(workflow, category);

  if (!firstRequest) {
    return errorResponse("Failed to build first photo request", 500, {
      code: "SESSION_BOOTSTRAP_FAILED",
    });
  }

  const { data: session, error: sessionError } = await supabase
    .from("ad_creation_sessions")
    .insert({
      store_id: store.id,
      ad_type: body.adType,
      intro_text: combinedIntroText,
      status: "collecting",
      style_preset: "food_card_news",
      workflow,
    })
    .select("id, status, style_preset, created_at")
    .single();

  if (sessionError || !session) {
    return errorResponse("Failed to start ad session", 500, {
      code: "AD_SESSION_CREATE_FAILED",
      details: sessionError?.message,
    });
  }

  if (body.adType === "photo") {
    after(async () => {
      try {
        await prepareAdSessionDrafts(session.id);
      } catch (draftError) {
        console.error("Ad session draft preparation failed", {
          sessionId: session.id,
          error: draftError,
        });
      }
    });
  }

  return successResponse(
    {
      sessionId: session.id,
      adType: body.adType,
      status: session.status,
      stylePreset: session.style_preset,
      createdAt: session.created_at,
      intro: {
        menuIntro: body.menuIntro?.trim() ?? null,
        storeSpecialty: body.storeSpecialty?.trim() ?? null,
        combinedText: combinedIntroText,
      },
      store: buildSessionSummary(store, workflow),
      currentRequest: {
        response: "success",
        status: "collecting",
        shotKey: firstRequest.shotKey,
        assetType: firstRequest.assetType,
        prompt: firstRequest.prompt,
        helperText: firstRequest.helperText,
      },
    },
    "Ad session started",
    201,
  );
}

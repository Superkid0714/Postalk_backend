import { requireStoreAccess } from "@/lib/auth/store-access";
import { readRequestBody } from "@/lib/api/request-body";
import { after } from "next/server";
import { buildReelsShotPlan, isReelsEnabled, REELS_SHOT_PLAN, type ReelsConcept } from "@/lib/ai/reels";
import { isCardNewsEnabled, type CardNewsTheme } from "@/lib/ai/cardnews-service";
import { parseAdMenus } from "@/lib/ad-menus";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSessionSummary,
  buildSessionWorkflowSeed,
  getDefaultSessionCategory,
  getRequestedShot,
} from "@/lib/ad-session";
import { prepareAdSessionDrafts } from "@/lib/ad-session-preparation";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

type StartAdSessionBody = {
  storeId?: string;
  adType?: "photo" | "video";
  menuIntro?: string;
  storeSpecialty?: string;
  introText?: string;
  cardNewsTheme?: CardNewsTheme;
  cardNewsStyle?: string;
  cardNewsMenus?: unknown;
  storeAddress?: unknown;
  reelsConcept?: ReelsConcept;
  reelsMenus?: unknown;
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
    body = (await readRequestBody(request)) as StartAdSessionBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const details: Array<{ field: string; reason: string }> = [];
  const cardNewsMenus = body.adType === "photo" ? parseAdMenus(body.cardNewsMenus) : undefined;
  if (body.adType === "photo" && body.cardNewsMenus !== undefined && !cardNewsMenus) {
    details.push({ field: "cardNewsMenus", reason: "Provide 1 to 3 menus with names up to 80 characters and descriptions up to 300 characters" });
  }
  const storeAddress = typeof body.storeAddress === "string" ? body.storeAddress.trim() : undefined;
  if (body.storeAddress !== undefined && (storeAddress === undefined || storeAddress.length > 200)) {
    details.push({ field: "storeAddress", reason: "Must be a string of at most 200 characters" });
  }
  if (!body.menuIntro?.trim() && cardNewsMenus) {
    body.menuIntro = cardNewsMenus.map(({ name, description }) => description ? `${name} - ${description}` : name).join("\n");
  }
  const combinedIntroText = buildCombinedIntroText(body);
  if (body.cardNewsTheme !== undefined && body.cardNewsTheme !== "minimal" && body.cardNewsTheme !== "christmas") {
    details.push({ field: "cardNewsTheme", reason: "Choose minimal or christmas" });
  }
  if (body.cardNewsStyle !== undefined && (typeof body.cardNewsStyle !== "string" || body.cardNewsStyle.length > 500)) {
    details.push({ field: "cardNewsStyle", reason: "Must be at most 500 characters" });
  }
  if (body.reelsConcept !== undefined && body.reelsConcept !== "simple" && body.reelsConcept !== "christmas") {
    details.push({ field: "reelsConcept", reason: "Choose simple or christmas" });
  }
  const reelsMenus = body.adType === "video"
    ? parseAdMenus(body.reelsMenus === undefined ? [{ name: body.menuIntro?.trim() || "대표 메뉴" }] : body.reelsMenus) ?? []
    : [];
  if (body.adType === "video" && reelsMenus.length === 0) {
    details.push({ field: "reelsMenus", reason: "Provide 1 to 3 menus with names up to 80 characters and optional descriptions up to 300 characters" });
  }

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

  const accessError = await requireStoreAccess(request, { storeId: body.storeId! });
  if (accessError) return accessError;

  const supabase = getSupabaseServiceClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, market_name, store_name, owner_name, category, description")
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
    videoShotPlan: body.adType === "video" && isReelsEnabled() ? buildReelsShotPlan(reelsMenus.length) : REELS_SHOT_PLAN,
    reelsMenus,
    cardNewsTheme: isCardNewsEnabled() ? body.cardNewsTheme ?? "minimal" : undefined,
    cardNewsStyle: body.cardNewsStyle?.trim(),
    cardNewsMenus,
    storeAddress,
    reelsConcept: isReelsEnabled() ? body.reelsConcept ?? "simple" : undefined,
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

  if (body.adType === "photo" && !workflow.cardNewsTheme) {
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
      reelsMenus: body.adType === "video" ? reelsMenus : undefined,
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

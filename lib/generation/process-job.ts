import {
  buildPromoCarouselPrompts,
  buildPromoPrompt,
  choosePromoImageCount,
  generateFoodCardNewsPlan,
  generatePromoCaption,
  generatePromoImage,
  normalizeStoreRelation,
  normalizeSubmissionRelation,
} from "@/lib/ai/generation";
import type { FoodCardNewsSourceAssets } from "@/lib/ai/food-card-news-render";
import type { FoodCardNewsCreativePlan } from "@/lib/ai/food-card-news";
import { reviewFoodCardNewsPlan } from "@/lib/ai/food-card-news-review";
import {
  getSubmissionWorkflowMetadata,
  mergeSubmissionWorkflowMetadata,
} from "@/lib/ad-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFoodCardNewsCreativePlan(
  value: unknown,
): value is FoodCardNewsCreativePlan {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.concept === "string" &&
    typeof value.tone === "string" &&
    Array.isArray(value.cards)
  );
}

function readPrecomputedCaptionRequest(value: unknown) {
  if (!isObject(value)) {
    return {
      caption: null,
      hashtags: [] as string[],
      foodCardNewsPlan: null as FoodCardNewsCreativePlan | null,
    };
  }

  const caption =
    typeof value.precomputedCaption === "string" &&
    value.precomputedCaption.trim().length > 0
      ? value.precomputedCaption.trim()
      : null;
  const hashtags = Array.isArray(value.precomputedHashtags)
    ? value.precomputedHashtags.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const foodCardNewsPlan = isFoodCardNewsCreativePlan(
    value.precomputedFoodCardNewsPlan,
  )
    ? value.precomputedFoodCardNewsPlan
    : null;

  return {
    caption,
    hashtags,
    foodCardNewsPlan,
  };
}

function readAdSessionId(value: unknown) {
  if (!isObject(value)) {
    return null;
  }

  return typeof value.adSessionId === "string" && value.adSessionId.trim().length > 0
    ? value.adSessionId
    : null;
}

type SessionSourceAssetRow = {
  shot_key: string;
  storage_bucket: string;
  file_path: string;
  sort_order: number;
};

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
) {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: safeConcurrency }, () => runWorker()),
  );

  return results;
}

function pickAssetByShot(
  assets: SessionSourceAssetRow[],
  shotKey: string,
) {
  return (
    assets
      .filter((asset) => asset.shot_key === shotKey)
      .sort((left, right) => left.sort_order - right.sort_order)[0] ?? null
  );
}

function pickFirstAvailableAsset(
  assets: SessionSourceAssetRow[],
  shotKeys: string[],
) {
  for (const shotKey of shotKeys) {
    const matched = pickAssetByShot(assets, shotKey);

    if (matched) {
      return matched;
    }
  }

  return assets.slice().sort((left, right) => left.sort_order - right.sort_order)[0] ?? null;
}

async function downloadAssetBytes(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  asset: SessionSourceAssetRow,
) {
  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .download(asset.file_path);

  if (error || !data) {
    throw new Error(error?.message ?? `Failed to download ${asset.file_path}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

async function buildFoodCardNewsSourceAssets(params: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  adSessionId: string;
}) {
  const { data: sessionAssets, error } = await params.supabase
    .from("ad_creation_session_assets")
    .select("shot_key, storage_bucket, file_path, sort_order")
    .eq("session_id", params.adSessionId)
    .order("sort_order", { ascending: true });

  if (error || !sessionAssets || sessionAssets.length === 0) {
    return null;
  }

  const assets = sessionAssets as SessionSourceAssetRow[];
  const menuBoardAsset = pickFirstAvailableAsset(assets, ["menu_board"]);
  const coverAsset = pickFirstAvailableAsset(assets, [
    "signature_menu",
    "flatlay_menu",
    "detail_closeup",
    "cooking_scene",
    "menu_board",
  ]);
  const flatlayAsset = pickFirstAvailableAsset(assets, [
    "flatlay_menu",
    "signature_menu",
    "detail_closeup",
  ]);
  const detailAsset = pickFirstAvailableAsset(assets, [
    "detail_closeup",
    "signature_menu",
    "flatlay_menu",
  ]);
  const cookingAsset = pickFirstAvailableAsset(assets, [
    "cooking_scene",
    "detail_closeup",
    "signature_menu",
  ]);
  const infoAsset = pickFirstAvailableAsset(assets, [
    "signature_menu",
    "flatlay_menu",
    "menu_board",
    "detail_closeup",
  ]);

  if (!menuBoardAsset || !coverAsset || !flatlayAsset || !detailAsset || !cookingAsset || !infoAsset) {
    return null;
  }

  const [
    menuBoard,
    coverPhoto,
    flatlayPhoto,
    detailPhoto,
    cookingPhoto,
    infoPhoto,
  ] = await Promise.all([
    downloadAssetBytes(params.supabase, menuBoardAsset),
    downloadAssetBytes(params.supabase, coverAsset),
    downloadAssetBytes(params.supabase, flatlayAsset),
    downloadAssetBytes(params.supabase, detailAsset),
    downloadAssetBytes(params.supabase, cookingAsset),
    downloadAssetBytes(params.supabase, infoAsset),
  ]);

  return {
    assets: {
      menuBoard,
      coverPhoto,
      flatlayPhoto,
      detailPhoto,
      cookingPhoto,
      infoPhoto,
    } satisfies FoodCardNewsSourceAssets,
    slots: {
      menuBoard: menuBoardAsset.shot_key,
      coverPhoto: coverAsset.shot_key,
      flatlayPhoto: flatlayAsset.shot_key,
      detailPhoto: detailAsset.shot_key,
      cookingPhoto: cookingAsset.shot_key,
      infoPhoto: infoAsset.shot_key,
    },
  };
}

function pickMockSourceAsset(
  assets:
    | Array<{
        asset_type: string;
        storage_bucket: string;
        file_path: string;
        sort_order: number;
      }>
    | null
    | undefined,
) {
  if (!assets || assets.length === 0) {
    return null;
  }

  const sortedAssets = [...assets].sort(
    (left, right) => left.sort_order - right.sort_order,
  );

  return (
    sortedAssets.find((asset) => asset.asset_type === "food_photo") ??
    sortedAssets.find((asset) => asset.asset_type === "menu_board") ??
    null
  );
}

export async function processGenerationJobById(jobId: string) {
  const supabase = getSupabaseAdminClient();

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select(`
      id,
      submission_id,
      store_id,
      status,
      style_preset,
      prompt_text,
      model_name,
      image_size,
      quality,
      request_payload,
      submissions (
        id,
        title,
        caption,
        store_type,
        target_menu_name,
        price_text,
        appeal_point,
        extra_message,
        ai_metadata,
        stores (
          market_name,
          store_name,
          owner_name,
          description
        ),
        submission_assets (
          asset_type,
          storage_bucket,
          file_path,
          sort_order
        )
      )
    `)
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    throw new Error("Generation job not found");
  }

  if (job.status === "processing") {
    return {
      jobId: job.id,
      status: job.status,
      alreadyProcessing: true,
    };
  }

  if (job.status === "completed") {
    return {
      jobId: job.id,
      status: job.status,
      alreadyCompleted: true,
    };
  }

  const normalizedSubmission = normalizeSubmissionRelation(job.submissions);

  if (!normalizedSubmission) {
    throw new Error("Generation job submission not found");
  }

  const normalizedGenerationSubmission = {
    ...normalizedSubmission,
    stores: normalizeStoreRelation(normalizedSubmission.stores),
  };

  const promptText =
    job.prompt_text ??
    buildPromoPrompt(normalizedGenerationSubmission, job.style_preset);

  const processingTime = new Date().toISOString();

  const { error: processingUpdateError } = await supabase
    .from("generation_jobs")
    .update({
      status: "processing",
      started_at: processingTime,
      failure_reason: null,
      prompt_text: promptText,
    })
    .eq("id", job.id);

  if (processingUpdateError) {
    throw new Error(processingUpdateError.message);
  }

  try {
    const isMockMode =
      job.model_name === "gpt-image-mock" ||
      Boolean(
        job.request_payload &&
          typeof job.request_payload === "object" &&
          "mockMode" in job.request_payload &&
          job.request_payload.mockMode === true,
      );

    const sourceAsset = isMockMode
      ? pickMockSourceAsset(normalizedSubmission.submission_assets)
      : null;

    let mockBytes: Buffer | null = null;

    if (isMockMode) {
      if (!sourceAsset) {
        throw new Error("Mock generation source asset not found");
      }

      const { data, error } = await supabase.storage
        .from(sourceAsset.storage_bucket)
        .download(sourceAsset.file_path);

      if (error || !data) {
        throw new Error(error?.message ?? "Mock source image download failed");
      }

      mockBytes = Buffer.from(await data.arrayBuffer());
    }

    const generatedImages = [];
    const precomputedRequest = readPrecomputedCaptionRequest(job.request_payload);
    const generatedCaptionResult = await generatePromoCaption(
      normalizedGenerationSubmission,
    );
    const captionResult = precomputedRequest.caption
      ? {
          ...generatedCaptionResult,
          caption: precomputedRequest.caption,
          hashtags:
            precomputedRequest.hashtags.length > 0
              ? precomputedRequest.hashtags
              : generatedCaptionResult.hashtags,
        }
      : generatedCaptionResult;
    const foodCardNewsPlan =
      job.style_preset === "food_card_news"
        ? precomputedRequest.foodCardNewsPlan ??
          (await generateFoodCardNewsPlan({
            ...normalizedGenerationSubmission,
            caption: captionResult.caption,
          }))
        : null;
    const reviewedFoodCardNewsPlan =
      job.style_preset === "food_card_news" && foodCardNewsPlan
        ? await reviewFoodCardNewsPlan({
            submission: {
              ...normalizedGenerationSubmission,
              caption: captionResult.caption,
            },
            plan: foodCardNewsPlan,
            publicDataContext: {
              marketLabel: captionResult.marketContext.found
                ? [
                    captionResult.marketContext.market_name,
                    captionResult.marketContext.district,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : null,
              weatherSummary: captionResult.weatherContext.selected_for_prompt
                ? captionResult.weatherContext.summary
                : null,
              festivalLabel:
                captionResult.festivalContext.found &&
                captionResult.festivalContext.verified
                  ? captionResult.festivalContext.title
                  : null,
              kamisLabel: captionResult.kamisContext.selected_for_prompt
                ? captionResult.kamisContext.region
                : null,
              tourismTone: captionResult.tourismCorpusContext.selected_for_prompt
                ? captionResult.tourismCorpusContext.region_scope
                : null,
            },
          })
        : null;
    const carouselPrompts = buildPromoCarouselPrompts(
      {
        ...normalizedGenerationSubmission,
        caption: captionResult.caption,
      },
      job.style_preset,
      {
        foodCardNewsPlan,
      },
    );
    const imageCount = choosePromoImageCount(
      normalizedGenerationSubmission,
      job.style_preset,
    );

    const generatedImageEntries = await mapWithConcurrency<
      (typeof carouselPrompts)[number],
      {
        assetId: string;
        filePath: string;
        promptKey: string;
        promptText: string;
        revisedPrompt: string | null;
        sourceMode: "mock" | "ai_generate";
        sourceShotKey: null;
        plannedSlotKey: string | null;
      }
    >(
      carouselPrompts,
      job.style_preset === "food_card_news" && !isMockMode ? 2 : 1,
      async (carouselPrompt) => {
        const reviewedCard = reviewedFoodCardNewsPlan?.cards.find(
          (card) => card.index === carouselPrompt.index,
        );
        const result = isMockMode
          ? {
              bytes: mockBytes!,
              revisedPrompt: `mock-image-generated-${carouselPrompt.key}`,
            }
          : await generatePromoImage({
              prompt: carouselPrompt.prompt,
              model: job.model_name,
              size:
                job.style_preset === "food_card_news"
                  ? "1024x1536"
                  : job.image_size,
              quality:
                job.style_preset === "food_card_news"
                  ? "high"
                  : job.quality,
              timeoutMs:
                job.style_preset === "food_card_news"
                  ? 300_000
                  : 120_000,
            });

        const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}-${carouselPrompt.index + 1}.png`;

        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(filePath, result.bytes, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const { data: asset, error: assetInsertError } = await supabase
          .from("submission_assets")
          .insert({
            submission_id: job.submission_id,
            asset_type: "generated_image",
            storage_bucket: "uploads",
            file_path: filePath,
            file_name: `${job.id}-${carouselPrompt.index + 1}.png`,
            mime_type: "image/png",
            file_size: result.bytes.byteLength,
            sort_order: carouselPrompt.index,
          })
          .select("id, file_path")
          .single();

        if (assetInsertError || !asset) {
          throw new Error(assetInsertError?.message ?? "Asset insert failed");
        }

        return {
          assetId: asset.id,
          filePath: asset.file_path,
          promptKey: carouselPrompt.key,
          promptText: carouselPrompt.prompt,
          revisedPrompt: result.revisedPrompt,
          sourceMode: isMockMode ? "mock" : "ai_generate",
          sourceShotKey: null,
          plannedSlotKey: reviewedCard?.selectedSlot ?? null,
        };
      },
    );

    generatedImages.push(...generatedImageEntries);

    const completedAt = new Date().toISOString();

    const { error: completeUpdateError } = await supabase
      .from("generation_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        failure_reason: null,
        result_asset_id: generatedImages[0]?.assetId ?? null,
        result_storage_bucket: "uploads",
        result_file_path: generatedImages[0]?.filePath ?? null,
        result_payload: {
          imageCount,
          generatedImages,
          mockMode: isMockMode,
          renderStrategy:
            job.style_preset === "food_card_news"
              ? "parallel_ai_generate_x2"
              : isMockMode
                ? "mock"
                : "ai_generate",
          foodCardNewsPlan,
          reviewedFoodCardNewsPlan,
          templateSlots: null,
        },
      })
      .eq("id", job.id);

    if (completeUpdateError) {
      throw new Error(completeUpdateError.message);
    }

    const currentWorkflow = getSubmissionWorkflowMetadata(
      normalizedSubmission.ai_metadata ?? null,
    );

    await supabase
      .from("submissions")
      .update({
        caption: captionResult.caption,
        hashtags: captionResult.hashtags,
        ai_metadata: mergeSubmissionWorkflowMetadata(
          {
            ...(isObject(normalizedSubmission.ai_metadata)
              ? normalizedSubmission.ai_metadata
              : {}),
            marketContext: captionResult.marketContext,
            weatherContext: captionResult.weatherContext,
            festivalContext: captionResult.festivalContext,
            kamisContext: captionResult.kamisContext,
            tourismCorpusContext: captionResult.tourismCorpusContext,
            captionInputContext: captionResult.captionInputContext,
            captionEvidence: captionResult.evidence,
          },
          {
            adType: currentWorkflow.adType ?? "photo",
            publishRequestStatus: "generated",
            currentJobId: job.id,
            lastCompletedJobId: job.id,
            generatedAt: completedAt,
            lastFailureReason: null,
          },
        ),
      })
      .eq("id", job.submission_id);

    return {
      jobId: job.id,
      status: "completed" as const,
      resultAssetId: generatedImages[0]?.assetId ?? null,
      filePath: generatedImages[0]?.filePath ?? null,
      imageCount,
    };
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Unknown generation error";

    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        failure_reason: failureReason,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    await supabase
      .from("submissions")
      .update({
        ai_metadata: mergeSubmissionWorkflowMetadata(
          normalizedSubmission.ai_metadata ?? null,
          {
            currentJobId: job.id,
            lastFailureReason: failureReason,
            publishRequestStatus: "draft",
          },
        ),
      })
      .eq("id", job.submission_id);

    throw new Error(failureReason);
  }
}

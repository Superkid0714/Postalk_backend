import {
  buildPromoCarouselPrompts,
  buildPromoPrompt,
  choosePromoImageCount,
  generatePromoCaption,
  generatePromoImage,
  normalizeStoreRelation,
  normalizeSubmissionRelation,
} from "@/lib/ai/generation";
import { renderFoodCardNewsCards } from "@/lib/ai/food-card-news-render";
import {
  getSubmissionWorkflowMetadata,
  mergeSubmissionWorkflowMetadata,
} from "@/lib/ad-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function pickPrimaryAssetByType(
  assets:
    | Array<{
        asset_type: string;
        storage_bucket: string;
        file_path: string;
        sort_order: number;
      }>
    | null
    | undefined,
  assetType: "food_photo" | "menu_board",
) {
  if (!assets || assets.length === 0) {
    return null;
  }

  return [...assets]
    .filter((asset) => asset.asset_type === assetType)
    .sort((left, right) => left.sort_order - right.sort_order)[0] ?? null;
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
          owner_name
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
  const carouselPrompts = buildPromoCarouselPrompts(
    normalizedGenerationSubmission,
    job.style_preset,
  );
  const imageCount = choosePromoImageCount(
    normalizedGenerationSubmission,
    job.style_preset,
  );

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
    const captionResult = await generatePromoCaption(normalizedGenerationSubmission);

    if (job.style_preset === "food_card_news") {
      const foodPhotoAsset = pickPrimaryAssetByType(
        normalizedSubmission.submission_assets,
        "food_photo",
      );
      const menuBoardAsset = pickPrimaryAssetByType(
        normalizedSubmission.submission_assets,
        "menu_board",
      );

      if (!foodPhotoAsset || !menuBoardAsset) {
        throw new Error("food_card_news requires both food_photo and menu_board assets");
      }

      const [foodPhotoDownload, menuBoardDownload] = await Promise.all([
        supabase.storage
          .from(foodPhotoAsset.storage_bucket)
          .download(foodPhotoAsset.file_path),
        supabase.storage
          .from(menuBoardAsset.storage_bucket)
          .download(menuBoardAsset.file_path),
      ]);

      if (foodPhotoDownload.error || !foodPhotoDownload.data) {
        throw new Error(
          foodPhotoDownload.error?.message ?? "Failed to load food photo asset",
        );
      }

      if (menuBoardDownload.error || !menuBoardDownload.data) {
        throw new Error(
          menuBoardDownload.error?.message ?? "Failed to load menu board asset",
        );
      }

      const renderedCards = await renderFoodCardNewsCards(
        {
          ...normalizedGenerationSubmission,
          caption: captionResult.caption,
        },
        {
          foodPhoto: Buffer.from(await foodPhotoDownload.data.arrayBuffer()),
          menuBoard: Buffer.from(await menuBoardDownload.data.arrayBuffer()),
        },
      );

      for (const card of renderedCards) {
        const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}-${card.index + 1}.png`;

        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(filePath, card.bytes, {
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
            file_name: `${job.id}-${card.index + 1}.png`,
            mime_type: "image/png",
            file_size: card.bytes.byteLength,
            sort_order: card.index,
          })
          .select("id, file_path")
          .single();

        if (assetInsertError || !asset) {
          throw new Error(assetInsertError?.message ?? "Asset insert failed");
        }

        generatedImages.push({
          assetId: asset.id,
          filePath: asset.file_path,
          promptKey: card.key,
          promptText: card.promptText,
          revisedPrompt: "template-rendered",
        });
      }
    } else {
      for (const carouselPrompt of carouselPrompts) {
        const result = isMockMode
          ? {
              bytes: mockBytes!,
              revisedPrompt: `mock-image-generated-${carouselPrompt.key}`,
            }
          : await generatePromoImage({
              prompt: carouselPrompt.prompt,
              model: job.model_name,
              size: job.image_size,
              quality: job.quality,
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

        generatedImages.push({
          assetId: asset.id,
          filePath: asset.file_path,
          promptKey: carouselPrompt.key,
          promptText: carouselPrompt.prompt,
          revisedPrompt: result.revisedPrompt,
        });
      }
    }

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
            festivalContext: captionResult.festivalContext,
            kamisContext: captionResult.kamisContext,
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

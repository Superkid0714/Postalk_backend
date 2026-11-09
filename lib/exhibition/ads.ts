import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMediaStorage } from "@/lib/storage/media";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { isUuid } from "@/lib/validation";

export async function loadExhibitionAd(adId: string, storeId: string) {
  if (!isUuid(adId)) throw new ExhibitionError("광고 번호를 확인해 주세요.");
  const { data, error } = await getSupabaseServiceClient().from("contents").select("*").eq("id", adId).eq("store_id", storeId).eq("user_id", 1).is("deleted_at", null).single();
  if (error || !data) throw new ExhibitionError("광고를 찾지 못했어요.", 404, "NOT_FOUND");
  return data;
}
export async function signedMedia(bucket: string, filePath: string) {
  const { data, error } = await getMediaStorage(getSupabaseServiceClient()).from(bucket).createSignedUrl(filePath, 3600);
  if (error || !data) throw new Error("미리보기를 불러오지 못했어요.");
  return data.signedUrl;
}
export async function exhibitionAdDetail(adId: string, storeId: string) {
  const ad = await loadExhibitionAd(adId, storeId);
  const supabase = getSupabaseServiceClient();
  const [submission, job] = await Promise.all([
    supabase.from("submissions").select("title,caption,ai_metadata").eq("id", ad.id).single(),
    supabase.from("generation_jobs").select("id,status,progress,result_payload,result_file_path,result_storage_bucket,failure_reason").eq("id", ad.job_id).single(),
  ]);
  if (submission.error || job.error || !submission.data || !job.data) throw new Error("광고를 불러오지 못했어요.");
  const generation = job.data;
  const bucket = generation.result_storage_bucket;
  const images = Array.isArray(generation.result_payload?.generatedImages) ? generation.result_payload.generatedImages as Array<{ filePath: string }> : [];
  const thumbnail = generation.result_payload?.thumbnailFilePath ?? (ad.format === "card_news" ? images[0]?.filePath : null);
  const outputs = generation.status === "completed" ? await contentMedia(ad.id, storeId, generation.id) : [];
  const normalizedResults = outputs.filter(item => item.purpose === (ad.format === "card_news" ? "card_image" : "reel_video"));
  const normalizedThumbnail = outputs.find(item => item.purpose === "thumbnail");
  const expected = ad.format === "card_news" ? images.length : 1;
  if (normalizedResults.length && normalizedResults.length !== expected) throw new Error("완성 파일 일부가 연결되지 않았어요.");
  const resultUrls = normalizedResults.length ? await Promise.all(normalizedResults.map(item => signedMedia(item.bucket, item.path)))
    : generation.status !== "completed" || !bucket ? [] : await Promise.all((ad.format === "card_news" ? images.map(image => image.filePath) : [generation.result_file_path]).filter((file): file is string => Boolean(file)).map(file => signedMedia(bucket, file)));
  return { adId: ad.id, format: ad.format, conceptId: ad.concept_id, title: submission.data.title, caption: submission.data.caption ?? "",
    publishStatus: ad.publish_status, permalink: submission.data.ai_metadata?.instagramPublish?.permalink ?? null,
    generationStatus: generation.status, jobId: generation.id, progress: generation.progress, message: generation.failure_reason,
    resultUrls,
    thumbnailUrl: normalizedThumbnail ? await signedMedia(normalizedThumbnail.bucket, normalizedThumbnail.path) : bucket && thumbnail ? await signedMedia(bucket, thumbnail) : null,
    requiresVerification: submission.data.ai_metadata?.instagramPublish?.outcomeUnknown === true,
    createdAt: ad.created_at };
}

export async function contentMedia(contentId: string, storeId: string, jobId: string) {
  const supabase = getSupabaseServiceClient();
  const { data: outputs, error } = await supabase.from("content_outputs").select("media_asset_id,purpose,sort_order")
    .eq("content_id", contentId).eq("store_id", storeId).eq("generation_job_id", jobId).order("sort_order");
  if (error) throw new Error("완성 파일 정보를 불러오지 못했어요.");
  if (!outputs?.length) return [];
  const { data: media, error: mediaError } = await supabase.from("media_assets").select("id,provider,bucket,object_key")
    .eq("store_id", storeId).in("id", outputs.map(item => item.media_asset_id));
  if (mediaError) throw new Error("완성 파일 위치를 불러오지 못했어요.");
  return outputs.map(output => {
    const file = media?.find(file => file.id === output.media_asset_id);
    if (!file) throw new Error("완성 파일 연결을 확인하지 못했어요.");
    return { purpose: output.purpose as string, bucket: file.bucket as string, path: file.object_key as string };
  });
}

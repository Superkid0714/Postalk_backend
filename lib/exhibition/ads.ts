import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMediaStorage } from "@/lib/storage/media";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { isUuid } from "@/lib/validation";

export async function loadExhibitionAd(adId: string, storeId: string) {
  if (!isUuid(adId)) throw new ExhibitionError("광고 번호를 확인해 주세요.");
  const { data, error } = await getSupabaseServiceClient().from("exhibition_ads").select("*").eq("id", adId).eq("store_id", storeId).eq("user_id", 1).is("deleted_at", null).single();
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
  const resultUrls = generation.status !== "completed" || !bucket ? [] : await Promise.all((ad.format === "card_news" ? images.map(image => image.filePath) : [generation.result_file_path]).filter((file): file is string => Boolean(file)).map(file => signedMedia(bucket, file)));
  const thumbnail = generation.result_payload?.thumbnailFilePath ?? (ad.format === "card_news" ? images[0]?.filePath : null);
  return { adId: ad.id, format: ad.format, conceptId: ad.concept_id, title: submission.data.title, caption: submission.data.caption ?? "",
    publishStatus: ad.publish_status, permalink: submission.data.ai_metadata?.instagramPublish?.permalink ?? null,
    generationStatus: generation.status, jobId: generation.id, progress: generation.progress, message: generation.failure_reason,
    resultUrls, thumbnailUrl: bucket && thumbnail ? await signedMedia(bucket, thumbnail) : null,
    narration: generation.result_payload?.narration ?? null, createdAt: ad.created_at };
}

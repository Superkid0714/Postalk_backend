import { exhibitionAccess, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { signedMedia } from "@/lib/exhibition/ads";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { successResponse } from "@/lib/api/response";

export async function GET(request: Request) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "20");
  const format = params.get("format") ?? "all";
  const publishStatus = params.get("publishStatus") ?? "all";
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new ExhibitionError("목록 페이지를 확인해 주세요.");
  if (!["all", "card_news", "reels"].includes(format) || !["all", "unpublished", "publishing", "published", "failed"].includes(publishStatus)) throw new ExhibitionError("광고 형식과 게시 상태를 확인해 주세요.");
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("exhibition_ads").select("id,format,concept_id,job_id,publish_status,created_at", { count: "exact" }).eq("store_id", storeId).eq("user_id", 1).is("deleted_at", null);
  if (format !== "all") query = query.eq("format", format);
  if (publishStatus !== "all") query = query.eq("publish_status", publishStatus);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  let totalAll = count ?? 0;
  if (format !== "all" || publishStatus !== "all") {
    const overall = await supabase.from("exhibition_ads").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("user_id", 1).is("deleted_at", null);
    if (overall.error) throw new Error(overall.error.message);
    totalAll = overall.count ?? 0;
  }
  const ids = (data ?? []).map(ad => ad.id);
  const jobs = ids.length ? await supabase.from("generation_jobs").select("id,submission_id,status,result_storage_bucket,result_payload").in("submission_id", ids) : { data: [], error: null };
  const submissions = ids.length ? await supabase.from("submissions").select("id,title").in("id", ids) : { data: [], error: null };
  if (jobs.error || submissions.error) throw new Error("목록을 불러오지 못했어요.");
  const items = await Promise.all((data ?? []).map(async ad => {
    const job = jobs.data?.find(job => job.id === ad.job_id);
    const thumbnail = job?.result_payload?.thumbnailFilePath ?? (ad.format === "card_news" ? job?.result_payload?.generatedImages?.[0]?.filePath : null);
    return { adId: ad.id, format: ad.format, conceptId: ad.concept_id, title: submissions.data?.find(row => row.id === ad.id)?.title ?? "",
      publishStatus: ad.publish_status, generationStatus: job?.status ?? "queued", createdAt: ad.created_at,
      thumbnailUrl: job?.result_storage_bucket && thumbnail ? await signedMedia(job.result_storage_bucket, thumbnail) : null };
  }));
  return successResponse({ items, page, pageSize, total: count ?? 0, totalAll, emptyReason: count === 0 ? (totalAll === 0 ? "no_ads" : "no_matches") : null, hasNext: page * pageSize < (count ?? 0) });
}); }

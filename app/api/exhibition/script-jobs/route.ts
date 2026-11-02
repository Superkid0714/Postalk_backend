import { after } from "next/server";
import { exhibitionAccess, exhibitionJson, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError, fingerprint, parseCreationInput } from "@/lib/exhibition/contract";
import { processExhibitionScript } from "@/lib/exhibition/scripts";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) { return exhibitionRoute(async () => {
  const body = await exhibitionJson(request);
  const { storeId } = exhibitionAccess(request, body);
  const input = parseCreationInput(body);
  if (input.format !== "reels" || !input.template.usesSubtitles) throw new ExhibitionError("이 템플릿은 대본 선행 생성을 사용하지 않아요.");
  const supabase = getSupabaseServiceClient();
  const digest = fingerprint(input);
  let { data: job, error } = await supabase.from("script_jobs").insert({ store_id: storeId, creation_id: input.creationId, input, input_digest: digest }).select("id,status,input_digest").single();
  if (error?.code === "23505") {
    const result = await supabase.from("script_jobs").select("id,status,input_digest").eq("store_id", storeId).eq("creation_id", input.creationId).single();
    job = result.data; error = result.error;
    if (job && job.input_digest !== digest) throw new ExhibitionError("입력 내용이 바뀌었어요. 새 제작 식별값으로 요청해 주세요.", 409, "CREATION_CONFLICT");
    if (job?.status === "failed") {
      const reset = await supabase.from("script_jobs").update({ status: "queued", failure_reason: null }).eq("id", job.id).eq("status", "failed");
      if (reset.error) throw new Error(reset.error.message);
      job.status = "queued";
    }
  }
  if (error || !job) throw new Error(error?.message ?? "대본 작업을 시작하지 못했어요.");
  const jobId = job.id;
  after(async () => { try { await processExhibitionScript(jobId); } catch (error) { console.error("Exhibition script failed", { jobId, error }); } });
  return successResponse({ jobId, status: job.status }, "대본 생성을 요청했어요.", 202);
}); }

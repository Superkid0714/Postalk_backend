import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { processVideoJobById } from "@/lib/generation/process-video-job";
import { processExhibitionJob } from "@/lib/exhibition/process";

export async function processAnyGenerationJob(jobId: string) {
  const { data, error } = await getSupabaseServiceClient().from("generation_jobs")
    .select("model_name,request_payload").eq("id", jobId).single();
  if (error || !data) throw new Error("Generation job not found");
  if (data.request_payload?.source === "exhibition") return processExhibitionJob(jobId);
  return data.model_name === "render-quote-video" || data.model_name.startsWith("veo")
    ? processVideoJobById(jobId)
    : processGenerationJobById(jobId);
}

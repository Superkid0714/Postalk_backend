import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { processVideoJobById } from "@/lib/generation/process-video-job";

export async function processAnyGenerationJob(jobId: string) {
  const { data, error } = await getSupabaseServiceClient().from("generation_jobs")
    .select("model_name").eq("id", jobId).single();
  if (error || !data) throw new Error("Generation job not found");
  return data.model_name === "render-quote-video" || data.model_name.startsWith("veo")
    ? processVideoJobById(jobId)
    : processGenerationJobById(jobId);
}

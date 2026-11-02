import type { NextRequest } from "next/server";
import { requireInternalWorkerKey } from "@/lib/auth/internal-worker";
import { errorResponse, successResponse } from "@/lib/api/response";
import { processAnyGenerationJob } from "@/lib/generation/process-any-job";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { syncInstagramPublishForSubmission } from "@/lib/instagram/publish";
import { PublishBusyError } from "@/lib/instagram/publish-lock";
import { processExhibitionScript } from "@/lib/exhibition/scripts";

export async function POST(request: NextRequest) {
  const authError = requireInternalWorkerKey(request);
  if (authError) return authError;
  const supabase = getSupabaseServiceClient();
  if (process.env.EXHIBITION_MODE_ENABLED === "true") {
    const { data: scripts, error: scriptError } = await supabase.from("script_jobs").select("id")
      .or(`status.eq.queued,and(status.eq.processing,lease_expires_at.lt.${new Date().toISOString()})`).order("updated_at", { ascending: true }).limit(5);
    if (scriptError) return errorResponse("Unable to load script jobs", 503, { code: "RECOVERY_FAILED" });
    for (const job of scripts ?? []) { try { await processExhibitionScript(job.id); } catch (error) { console.error("Exhibition script recovery failed", { jobId: job.id, error }); } }
  }
  const { data: publishes, error: publishError } = await supabase.from("submissions")
    .select("id, ai_metadata").eq("ai_metadata->instagramPublish->>status", "processing")
    .not("ai_metadata->instagramPublish->>containerId", "is", null)
    .or("ai_metadata->instagramPublish->>outcomeUnknown.is.null,ai_metadata->instagramPublish->>outcomeUnknown.eq.false")
    .order("updated_at", { ascending: true }).limit(5);
  if (publishError) return errorResponse("Unable to load pending publishes", 503, { code: "RECOVERY_FAILED" });
  for (const submission of publishes ?? []) {
    const metadata = submission.ai_metadata?.instagramPublish;
    if (!metadata?.containerId || metadata.outcomeUnknown) continue;
    try { await syncInstagramPublishForSubmission(submission.id); }
    catch (error) {
      if (!(error instanceof PublishBusyError)) console.error("Instagram publish sync failed", { submissionId: submission.id, error });
    }
  }
  const { data: jobs, error } = await supabase.from("generation_jobs")
    .select("id").in("status", ["queued", "processing"])
    .order("updated_at", { ascending: true }).limit(5);
  if (error) return errorResponse("Unable to load pending jobs", 503, { code: "RECOVERY_FAILED" });
  const results = [];
  for (const job of jobs ?? []) {
    try {
      results.push(await processAnyGenerationJob(job.id));
    } catch (error) {
      console.error("Generation recovery failed", { jobId: job.id, error });
      results.push({ jobId: job.id, status: "error" });
    }
    // Rotate unfinished provider operations so they cannot starve later jobs.
    await supabase.from("generation_jobs").update({ updated_at: new Date().toISOString() }).eq("id", job.id);
    const { data: current } = await supabase.from("generation_jobs").select("status").eq("id", job.id).single();
    if (current?.status === "completed" || current?.status === "failed") {
      await supabase.from("ad_creation_sessions").update({ status: current.status })
        .eq("generation_job_id", job.id).in("status", ["generating", "ready_for_generation"]);
    }
  }
  return successResponse({ results }, "Pending generation jobs checked");
}

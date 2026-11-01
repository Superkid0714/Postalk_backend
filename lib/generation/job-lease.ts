import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// This is deliberately longer than a single provider request (at most 300s).
// A crashed process stops renewing; the worker can reclaim it after expiry.
export const JOB_LEASE_SECONDS = 900;

export async function withGenerationJobLease<T>(
  jobId: string,
  process: () => Promise<T>,
  supabase: SupabaseClient = getSupabaseServiceClient(),
) {
  const owner = randomUUID();
  const { data: acquired, error } = await supabase.rpc("claim_generation_job", {
    p_job_id: jobId, p_owner: owner, p_lease_seconds: JOB_LEASE_SECONDS,
  });
  if (error) throw new Error(`Unable to claim generation job: ${error.message}`);
  if (!acquired) return { jobId, status: "processing" as const, alreadyProcessing: true, completed: false };

  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = (async () => {
      const { data: renewed, error: renewalError } = await supabase.rpc("renew_generation_job_lease", {
        p_job_id: jobId, p_owner: owner, p_lease_seconds: JOB_LEASE_SECONDS,
      });
      if (renewalError) console.error("Generation job lease renewal failed", { jobId, message: renewalError.message });
      else if (!renewed) console.error("Generation job lease ownership was lost", { jobId });
    })().catch(error => console.error("Generation job lease renewal failed", { jobId, error }))
      .finally(() => { renewing = undefined; });
  }, 30_000);
  timer.unref();
  try {
    return await process();
  } finally {
    clearInterval(timer);
    await renewing;
    // Never release a lease acquired by a replacement worker.
    const { error: releaseError } = await supabase.from("generation_job_leases").delete().eq("job_id", jobId).eq("owner", owner);
    if (releaseError) console.error("Generation job lease release failed", { jobId, message: releaseError.message });
  }
}

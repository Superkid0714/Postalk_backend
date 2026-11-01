import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export class PublishBusyError extends Error {
  constructor() { super("An Instagram publish operation is already in progress"); }
}

export async function withPublishLock<T>(submissionId: string, action: () => Promise<T>) {
  const supabase = getSupabaseServiceClient();
  const owner = randomUUID();
  const args = { p_submission_id: submissionId, p_owner: owner };
  const { data, error } = await supabase.rpc("claim_submission_publish", args);
  if (error) throw new Error(`Unable to claim publish operation: ${error.message}`);
  if (!data) throw new PublishBusyError();
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = (async () => {
      const { data, error } = await supabase.rpc("renew_submission_publish", args);
      if (error || !data) console.error("Publish lease renewal failed", { submissionId });
    })().catch(error => console.error("Publish lease renewal failed", { submissionId, error }))
      .finally(() => { renewing = undefined; });
  }, 30_000);
  timer.unref();
  try {
    return await action();
  } finally {
    clearInterval(timer);
    await renewing;
    await supabase.from("submission_publish_leases").delete().eq("submission_id", submissionId).eq("owner", owner);
  }
}

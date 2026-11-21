import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { syncInstagramPublishForSubmission } from "@/lib/instagram/publish";
import { PublishBusyError } from "@/lib/instagram/publish-lock";

/** Finish only recent, explicit /publish requests; never revive the old backlog. */
export async function recoverRequestedInstagramPublishes() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await getSupabaseServiceClient().from("submissions")
    .select("id,ai_metadata")
    .eq("ai_metadata->instagramPublish->>status", "processing")
    .eq("ai_metadata->instagramPublish->>autoCompleteRequested", "true")
    .gte("ai_metadata->instagramPublish->>requestedAt", cutoff)
    .not("ai_metadata->instagramPublish->>containerId", "is", null)
    .is("ai_metadata->instagramPublish->>publishAttemptedAt", null)
    .or("ai_metadata->instagramPublish->>outcomeUnknown.is.null,ai_metadata->instagramPublish->>outcomeUnknown.eq.false")
    .order("updated_at", { ascending: true }).limit(5);
  if (error) throw new Error("Unable to load requested Instagram publications");
  const results = [];
  for (const row of data ?? []) {
    if (row.ai_metadata?.exhibitionDeletedAt) continue;
    const state = row.ai_metadata?.instagramPublish;
    if (state?.autoCompleteRequested !== true || state.status !== "processing" || state.publishedMediaId || state.outcomeUnknown || state.publishAttemptedAt ||
        !state.containerId || typeof state.requestedAt !== "string" || state.requestedAt < cutoff) continue;
    try { results.push(await syncInstagramPublishForSubmission(row.id)); }
    catch (error) {
      if (error instanceof PublishBusyError) continue;
      console.error("Requested Instagram completion failed", { submissionId: row.id, errorType: error instanceof Error ? error.name : "unknown" });
      results.push({ submissionId: row.id, status: "error" });
    }
  }
  return results;
}

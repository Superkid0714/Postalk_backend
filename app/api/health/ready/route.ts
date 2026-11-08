import { NextResponse } from "next/server";

import { readMediaStorageConfig } from "@/lib/storage/media";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type DependencyStatus = "ok" | "error" | "skipped";

/**
 * Readiness differs from /api/health: it verifies the configured Supabase
 * service role can read the database and inspect the private uploads bucket.
 * It never returns secrets, records, or provider error details.
 */
export async function GET() {
  const mediaConfig = readMediaStorageConfig();
  const supabase = getSupabaseServiceClient();

  const [databaseResult, bucketsResult] = await Promise.allSettled([
    supabase.from("stores").select("id").limit(1),
    mediaConfig.provider === "supabase"
      ? supabase.storage.listBuckets()
      : Promise.resolve(null),
  ]);

  const database: DependencyStatus =
    databaseResult.status === "fulfilled" && !databaseResult.value.error
      ? "ok"
      : "error";

  let storage: DependencyStatus = "skipped";
  if (mediaConfig.provider === "supabase") {
    storage =
      bucketsResult.status === "fulfilled" &&
      !bucketsResult.value?.error &&
      Boolean(bucketsResult.value?.data?.some((bucket) => bucket.name === "uploads"))
        ? "ok"
        : "error";
  }

  const ready = database === "ok" && storage !== "error";

  return NextResponse.json(
    {
      status: ready ? "ok" : "error",
      service: "postalk-backend",
      dependencies: {
        database,
        storage,
        mediaProvider: mediaConfig.provider,
      },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}

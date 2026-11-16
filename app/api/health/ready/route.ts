import { NextResponse } from "next/server";

import { readMediaStorageConfig } from "@/lib/storage/media";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Readiness differs from /api/health: it verifies the configured Supabase
 * service role can read the database and inspect the private uploads bucket.
 * It never returns secrets, records, or provider error details.
 */
export async function GET() {
  const mediaConfig = readMediaStorageConfig();
  const supabase = getSupabaseServiceClient();

  const [databaseResult, bucketsResult] = await Promise.allSettled([
    supabase.from("stores").select("id, guest_session_hash").limit(1),
    supabase.storage.listBuckets(),
  ]);

  const database =
    databaseResult.status === "fulfilled" && !databaseResult.value.error
      ? "ok"
      : "error";

  const storage =
    bucketsResult.status === "fulfilled" &&
    !bucketsResult.value.error &&
    bucketsResult.value.data?.some((bucket) => bucket.name === mediaConfig.bucket)
      ? "ok"
      : "error";

  const ready = database === "ok" && storage === "ok";

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

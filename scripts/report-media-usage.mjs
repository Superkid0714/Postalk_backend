// Read-only. Invoke with: node --env-file=.env.staging scripts/report-media-usage.mjs
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export function buildUsageReport(groups, warningGB = 70) {
  if (!Array.isArray(groups) || !Number.isFinite(warningGB) || warningGB <= 0) throw new Error("Invalid usage report configuration");
  const count = value => {
    const number = Number(value ?? 0);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid usage data");
    return number;
  };
  const totals = groups.reduce((sum, row) => ({
    registeredBytes: sum.registeredBytes + count(row.bytes),
    supabaseRegisteredBytes: sum.supabaseRegisteredBytes + (row.provider === "supabase" ? count(row.bytes) : 0),
    objects: sum.objects + count(row.objects),
    unknownSizeObjects: sum.unknownSizeObjects + count(row.unknown_size_objects),
    unreferencedCandidates: sum.unreferencedCandidates + count(row.unreferenced_objects),
  }), { registeredBytes: 0, supabaseRegisteredBytes: 0, objects: 0, unknownSizeObjects: 0, unreferencedCandidates: 0 });
  return {
    ...totals,
    registeredGB: Number((totals.registeredBytes / 1e9).toFixed(3)),
    supabaseRegisteredGB: Number((totals.supabaseRegisteredBytes / 1e9).toFixed(3)),
    warningGB,
    storageWarning: totals.supabaseRegisteredBytes >= warningGB * 1e9,
    scope: "This project's DB-registered files only, not organization-wide quota or egress. Check Supabase Usage. Unreferenced candidates are not deletion approval.",
    groups,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing staging/server configuration");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("media_usage_summary");
  if (error) throw new Error("Media usage RPC unavailable");
  console.log(JSON.stringify(buildUsageReport(data, Number(process.env.MEDIA_STORAGE_WARNING_GB || 70)), null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    console.error("미디어 용량 조회에 실패했어요. 지정한 환경 파일과 DB 마이그레이션 적용 여부를 확인해 주세요.");
    process.exitCode = 1;
  });
}

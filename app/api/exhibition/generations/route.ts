import { after } from "next/server";
import { creationToken, exhibitionAccess, exhibitionJson, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError, fingerprint, object, parseCreationInput, parseSubtitles } from "@/lib/exhibition/contract";
import { processExhibitionJob } from "@/lib/exhibition/process";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

export async function POST(request: Request) { return exhibitionRoute(async () => {
  const body = await exhibitionJson(request);
  const { storeId } = exhibitionAccess(request, body);
  const input = parseCreationInput(body);
  const subtitles = parseSubtitles(body.subtitles, input);
  const token = creationToken(input.creationId, storeId);
  if (!Array.isArray(body.materials) || body.materials.length !== input.template.scenes.length) throw new ExhibitionError("모든 장면의 재료를 올려 주세요.");
  const assets = body.materials.map((value, index) => {
    const material = object(value);
    if (material.sceneNumber !== index + 1 || !isUuid(material.assetId)) throw new ExhibitionError("재료 순서와 파일 식별값을 확인해 주세요.");
    return material.assetId;
  });
  if (new Set(assets).size !== assets.length) throw new ExhibitionError("같은 재료가 중복되었어요.");
  const { data, error } = await getSupabaseServiceClient().rpc("create_exhibition_ad", {
    p_store_id: storeId, p_input: input, p_digest: fingerprint({ input, assets, subtitles }), p_assets: assets, p_subtitles: subtitles,
  });
  if (error) {
    if (error.message.includes("CREATION_CONFLICT") || error.message.includes("AD_DELETED")) throw new ExhibitionError("제작 내용이 바뀌었어요. 새 제작으로 시작해 주세요.", 409, "CREATION_CONFLICT");
    if (error.message.includes("MATERIALS_INVALID") || error.message.includes("VIDEO_TOO_SHORT")) throw new ExhibitionError("장면별 재료와 영상 길이를 확인해 주세요.");
    throw new Error(error.message);
  }
  const jobId = data.jobId as string;
  after(async () => { try { await processExhibitionJob(jobId); } catch (error) { console.error("Exhibition generation failed", { jobId, error }); } });
  return successResponse({ ...data, creationToken: token }, "광고 제작을 요청했어요.", 202);
}); }

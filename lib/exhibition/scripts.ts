import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getOpenAiApiKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import { parseCreationInput, parseSubtitles, type CreationInput } from "@/lib/exhibition/contract";

export function responseText(value: unknown): string {
  const json = value as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return json.output_text ?? (json.output ?? []).flatMap(item => item.content ?? []).map(item => item.text ?? "").join("");
}
export function ruleSubtitles(input: CreationInput) {
  return input.template.scenes.map(scene => {
    const menu = input.menus.find(menu => menu.id === scene.menuId);
    const source = menu ? `${menu.name}, ${menu.description || "정성껏 준비했어요"}` : input.storeDescription;
    return { sceneNumber: scene.sceneNumber, text: [...source].slice(0, input.template.maxSubtitleChars).join("") };
  });
}
export async function buildSceneSubtitles(input: CreationInput) {
  const key = getOpenAiApiKey();
  if (!key) return { scenes: ruleSubtitles(input), source: "rule" };
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.EXHIBITION_SCRIPT_MODEL || "gpt-4.1-mini", input:
      `다음 가게·메뉴·장면 정보로 한국어 광고 내레이션을 작성하세요. 입력에 없는 사실이나 가격을 만들지 마세요. 각 문장은 자막과 TTS에 동일하게 사용합니다. 장면 순서를 유지하고 문장당 ${input.template.maxSubtitleChars}자 이하로 작성하세요. 마크다운 없이 {"scenes":[{"sceneNumber":1,"text":"문장"}]} JSON만 출력하세요.\n${JSON.stringify(input)}` }), timeoutMs: 45_000,
  });
  if (!response.ok) throw new Error("대본 생성 서비스에 연결하지 못했어요.");
  const content = responseText(await response.json()).replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed = JSON.parse(content) as { scenes?: unknown };
  return { scenes: parseSubtitles(parsed.scenes, input), source: "ai" };
}

export async function processExhibitionScript(jobId: string) {
  const supabase = getSupabaseServiceClient();
  const owner = randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_exhibition_script", { p_job_id: jobId, p_owner: owner });
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return;
  try {
    const { data, error } = await supabase.from("script_jobs").select("input").eq("id", jobId).single();
    if (error || !data) throw new Error("대본 작업을 찾지 못했어요.");
    const input = parseCreationInput(data.input);
    const result = await buildSceneSubtitles(input);
    const { error: updateError } = await supabase.from("script_jobs").update({
      status: "completed", result: { ...result, scenes: result.scenes.map(scene => ({ ...scene, target: input.template.scenes[scene.sceneNumber - 1].target })) },
      failure_reason: null, updated_at: new Date().toISOString(),
    }).eq("id", jobId).eq("lease_owner", owner);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    await supabase.from("script_jobs").update({ status: "failed", failure_reason: "대본을 만들지 못했어요. 다시 요청해 주세요.", updated_at: new Date().toISOString() }).eq("id", jobId).eq("lease_owner", owner);
    throw error;
  }
}

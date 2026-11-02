import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMediaStorage, getUploadStorageBucket } from "@/lib/storage/media";
import { withGenerationJobLease } from "@/lib/generation/job-lease";
import { parseCreationInput, parseSubtitles, type Scene } from "@/lib/exhibition/contract";
import { cardThumbnail, renderCard, renderReel } from "@/lib/exhibition/render";

type Material = { sceneNumber: number; storageBucket: string; filePath: string; mimeType: string };
export async function processExhibitionJob(jobId: string) {
  return withGenerationJobLease(jobId, async () => {
    const supabase = getSupabaseServiceClient();
    const { data: job, error } = await supabase.from("generation_jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error("광고 제작 작업을 찾지 못했어요.");
    if (job.status === "completed" || job.status === "failed") return { jobId, status: job.status };
    const input = parseCreationInput(job.request_payload.input);
    const subtitles = parseSubtitles(job.request_payload.subtitles, input);
    const materials = job.request_payload.materials as Material[];
    const total = input.template.scenes.length + 2;
    const active = async () => {
      const { data, error } = await supabase.from("exhibition_ads").select("deleted_at").eq("id", job.submission_id).single();
      if (error || !data || data.deleted_at) throw new Error("삭제된 광고의 제작을 중단했어요.");
    };
    const progress = async (stage: string, current: number, message: string) => {
      await active();
      const { error } = await supabase.from("generation_jobs").update({ status: "processing", progress: { stage, current, total, message } }).eq("id", jobId);
      if (error) throw new Error(error.message);
    };
    try {
      await progress("preparing", 0, "올려주신 재료를 확인하고 있어요.");
      const { data: store, error: storeError } = await supabase.from("stores").select("store_name").eq("id", job.store_id).single();
      if (storeError || !store) throw new Error("가게 정보를 확인하지 못했어요.");
      const caption = [...`${store.store_name}\n\n${input.storeDescription}\n\n${input.menus.map(menu => `${menu.name}${menu.description ? `: ${menu.description}` : ""}`).join("\n")}`.replace(/#/g, "")].slice(0, 2200).join("");
      const bucket = getUploadStorageBucket();
      const generatedImages: Array<{ assetId: string; filePath: string; promptKey: string }> = [];
      const load = async (scene: Scene) => {
        await active();
        const material = materials.find(item => item.sceneNumber === scene.sceneNumber);
        if (!material) throw new Error("촬영 재료가 비어 있어요.");
        const { data, error } = await getMediaStorage(supabase).from(material.storageBucket).download(material.filePath);
        if (error || !data) throw new Error("촬영 재료를 불러오지 못했어요.");
        return new Uint8Array(await data.arrayBuffer());
      };
      const save = async (bytes: Uint8Array, filePath: string, assetType: string, mimeType: string, order = 0) => {
        await active();
        const { error: uploadError } = await getMediaStorage(supabase).from(bucket).upload(filePath, bytes, { contentType: mimeType, upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        const { data: previous, error: lookupError } = await supabase.from("submission_assets").select("id").eq("submission_id", job.submission_id).eq("file_path", filePath).maybeSingle();
        if (lookupError) throw new Error(lookupError.message);
        if (previous) {
          const { error } = await supabase.from("submission_assets").update({ storage_bucket: bucket, file_size: bytes.byteLength }).eq("id", previous.id);
          if (error) throw new Error(error.message);
          return previous.id as string;
        }
        const { data, error } = await supabase.from("submission_assets").insert({ submission_id: job.submission_id, asset_type: assetType,
          storage_bucket: bucket, file_path: filePath, file_name: filePath.split("/").pop(), mime_type: mimeType, file_size: bytes.byteLength, sort_order: order }).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "결과물을 저장하지 못했어요.");
        return data.id as string;
      };
      let resultId: string;
      let resultPath: string;
      let thumbnailPath: string | null = null;
      const root = `${job.store_id}/${job.submission_id}/generated/${jobId}`;
      if (input.format === "card_news") {
        for (const scene of input.template.scenes) {
          await progress("rendering", scene.sceneNumber - 1, `${scene.sceneNumber}번째 카드뉴스를 만들고 있어요.`);
          const menu = input.menus.find(menu => menu.id === scene.menuId);
          const image = await renderCard(await load(scene), menu?.name ?? store.store_name, menu?.description ?? input.storeDescription);
          const filePath = `${root}-${scene.sceneNumber}.png`;
          const assetId = await save(image, filePath, "generated_image", "image/png", scene.sceneNumber - 1);
          generatedImages.push({ assetId, filePath, promptKey: `scene-${scene.sceneNumber}` });
          if (scene.sceneNumber === 1) {
            thumbnailPath = `${root}-thumb.jpg`;
            const { error } = await getMediaStorage(supabase).from(bucket).upload(thumbnailPath, await cardThumbnail(image), { contentType: "image/jpeg", upsert: true });
            if (error) throw new Error(error.message);
          }
        }
        resultId = generatedImages[0].assetId; resultPath = generatedImages[0].filePath;
      } else {
        await progress("rendering", 0, input.template.usesSubtitles ? "자막과 같은 문장으로 음성을 만들고 있어요." : "영상을 연결하고 있어요.");
        const rendered = await renderReel(input, load, subtitles, scene => progress("rendering", scene.sceneNumber, `${scene.sceneNumber}번째 장면을 완성했어요.`));
        resultPath = `${root}.mp4`; thumbnailPath = `${root}.jpg`;
        resultId = await save(rendered.video, resultPath, "generated_video", "video/mp4");
        await save(rendered.thumbnail, thumbnailPath, "video_thumbnail", "image/jpeg");
      }
      await progress("saving", total - 1, "완성한 광고를 보관하고 있어요.");
      const { error: captionError } = await supabase.from("submissions").update({ caption, hashtags: [] }).eq("id", job.submission_id);
      if (captionError) throw new Error(captionError.message);
      await active();
      const { error: completionError } = await supabase.from("generation_jobs").update({ status: "completed", completed_at: new Date().toISOString(), failure_reason: null,
        result_asset_id: resultId, result_storage_bucket: bucket, result_file_path: resultPath,
        result_payload: { generatedImages, thumbnailFilePath: thumbnailPath, format: input.format, narration: input.template.usesSubtitles ? { isAiGenerated: true, disclosure: "이 영상의 내레이션은 AI가 만든 음성이에요." } : null },
        progress: { stage: "completed", current: total, total, message: "광고가 완성되었어요." },
      }).eq("id", jobId);
      if (completionError) throw new Error(completionError.message);
      return { jobId, status: "completed" as const };
    } catch (error) {
      await supabase.from("generation_jobs").update({ status: "failed", failure_reason: "광고를 만들지 못했어요. 재료를 확인하고 다시 시도해 주세요.", completed_at: new Date().toISOString(),
        progress: { stage: "failed", message: "광고 제작을 완료하지 못했어요. 다시 시도할 수 있어요." } }).eq("id", jobId);
      throw error;
    }
  });
}

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { fetchWithTimeout } from "@/lib/http";
import type { CreationInput, Scene } from "@/lib/exhibition/contract";

const ffmpeg = () => process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
async function run(args: string[], cwd: string, probe = false) {
  return new Promise<string>((resolve, reject) => {
    // Uploaded files cannot turn probing/rendering into remote playlist fetches.
    const concat = args.includes("concat");
    const formats = `${concat ? "concat," : ""}mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,png_pipe,jpeg_pipe,webp_pipe,wav`;
    const localInputs = args.flatMap(arg => arg === "-i" ? ["-protocol_whitelist", "file,pipe", "-format_whitelist", formats, arg] : [arg]);
    const child = spawn(ffmpeg(), ["-hide_banner", "-nostdin", ...localInputs], { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("미디어 처리 시간이 초과되었어요.")); }, 120_000);
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-64_000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0 || (probe && code === 1)) resolve(stderr); else reject(new Error(`미디어를 처리하지 못했어요. ${stderr.slice(-500)}`)); });
  });
}
export function parseMediaProbe(stderr: string) {
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const dimensions = stderr.match(/Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return { durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
    width: dimensions ? Number(dimensions[1]) : null, height: dimensions ? Number(dimensions[2]) : null, hasAudio: /Audio:/.test(stderr) };
}
export async function inspectMedia(bytes: Uint8Array) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "postalk-probe-"));
  try {
    await writeFile(path.join(directory, "input"), bytes);
    const result = parseMediaProbe(await run(["-i", "input"], directory, true));
    if (!result.width || !result.height) throw new Error("사진 또는 영상 파일을 읽지 못했어요.");
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function font(directory: string) { await copyFile(path.join(process.cwd(), "assets/fonts/NotoSansCJKkr-Regular.otf"), path.join(directory, "font.otf")); }
function wrap(text: string, columns = 18) {
  const characters = [...text.replace(/[\r\n]+/g, " ")];
  const lines = [];
  while (characters.length) lines.push(characters.splice(0, columns).join(""));
  return lines.join("\n");
}
export async function renderCard(bytes: Uint8Array, title: string, description: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "postalk-card-"));
  try {
    await Promise.all([font(directory), writeFile(path.join(directory, "input"), bytes), writeFile(path.join(directory, "title.txt"), wrap([...title].slice(0, 36).join(""), 18)), writeFile(path.join(directory, "description.txt"), wrap([...description].slice(0, 60).join(""), 30))]);
    await run(["-y", "-i", "input", "-vf", "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,pad=1080:1350:0:0:color=0x111827,drawtext=fontfile=font.otf:textfile=title.txt:expansion=none:fontsize=42:fontcolor=white:x=50:y=1100,drawtext=fontfile=font.otf:textfile=description.txt:expansion=none:fontsize=28:fontcolor=white:x=50:y=1210", "-frames:v", "1", "output.png"], directory);
    return await readFile(path.join(directory, "output.png"));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function cardThumbnail(bytes: Uint8Array) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "postalk-card-thumb-"));
  try {
    await writeFile(path.join(directory, "input"), bytes);
    await run(["-y", "-i", "input", "-vf", "scale=360:450", "-frames:v", "1", "thumbnail.jpg"], directory);
    return await readFile(path.join(directory, "thumbnail.jpg"));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

// Provider-neutral WAV contract. No default is tied to a retiring Speech API/model.
export async function synthesizeNarration(text: string) {
  const endpoint = process.env.EXHIBITION_TTS_API_URL;
  if (!endpoint) throw new Error("음성 합성 서비스 설정을 확인해 주세요.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("음성 합성 서비스에는 HTTPS 주소가 필요해요.");
  const response = await fetchWithTimeout(url, { method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.EXHIBITION_TTS_API_KEY ? { Authorization: `Bearer ${process.env.EXHIBITION_TTS_API_KEY}` } : {}) },
    body: JSON.stringify({ input: text, response_format: "wav", ...(process.env.EXHIBITION_TTS_MODEL ? { model: process.env.EXHIBITION_TTS_MODEL } : {}), ...(process.env.EXHIBITION_TTS_VOICE ? { voice: process.env.EXHIBITION_TTS_VOICE } : {}) }), timeoutMs: 60_000,
  });
  if (!response.ok) throw new Error("음성을 만들지 못했어요. 다시 시도해 주세요.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("음성 응답이 너무 커요.");
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("음성 서비스가 WAV 파일을 반환하지 않았어요.");
  return bytes;
}

export async function renderReel(input: CreationInput, load: (scene: Scene) => Promise<Uint8Array>, subtitles: Array<{ sceneNumber: number; text: string }>, onScene: (scene: Scene) => Promise<void>, synthesize = synthesizeNarration) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "postalk-reel-"));
  try {
    if (input.template.usesSubtitles) await font(directory);
    for (const scene of input.template.scenes) {
      const source = `source-${scene.sceneNumber}`;
      await writeFile(path.join(directory, source), await load(scene));
      const probe = parseMediaProbe(await run(["-i", source], directory, true));
      if (scene.mediaType === "video" && (!probe.durationSeconds || probe.durationSeconds + 0.05 < scene.durationSeconds)) throw new Error(`${scene.sceneNumber}번 영상이 너무 짧아요. 다시 촬영해 주세요.`);
      const output = `scene-${scene.sceneNumber}.mp4`;
      let duration = scene.durationSeconds;
      const args = ["-y", ...(scene.mediaType === "image" ? ["-loop", "1"] : ["-stream_loop", "-1"]), "-i", source];
      let filter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30";
      if (input.template.usesSubtitles) {
        const text = subtitles.find(item => item.sceneNumber === scene.sceneNumber)?.text;
        if (!text) throw new Error("장면 자막이 비어 있어요.");
        const audio = `voice-${scene.sceneNumber}.wav`;
        const caption = `caption-${scene.sceneNumber}.txt`;
        await writeFile(path.join(directory, audio), await synthesize(text));
        await writeFile(path.join(directory, caption), wrap(text));
        const voice = parseMediaProbe(await run(["-i", audio], directory, true));
        if (!voice.durationSeconds) throw new Error("음성 길이를 확인하지 못했어요.");
        duration = Math.max(duration, voice.durationSeconds + 0.2);
        args.push("-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-af", "apad", "-ar", "48000", "-ac", "2", "-c:a", "aac");
        filter += `,drawtext=fontfile=font.otf:textfile=${caption}:expansion=none:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12:x=(w-text_w)/2:y=h-text_h-140`;
      } else args.push("-an");
      args.push("-vf", filter, "-t", String(duration), "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output);
      await run(args, directory);
      await onScene(scene);
    }
    await writeFile(path.join(directory, "concat.txt"), input.template.scenes.map(scene => `file 'scene-${scene.sceneNumber}.mp4'`).join("\n"));
    await run(["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "-movflags", "+faststart", "result.mp4"], directory);
    await run(["-y", "-i", "result.mp4", "-frames:v", "1", "-vf", "scale=360:640", "thumbnail.jpg"], directory);
    return { video: await readFile(path.join(directory, "result.mp4")), thumbnail: await readFile(path.join(directory, "thumbnail.jpg")) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

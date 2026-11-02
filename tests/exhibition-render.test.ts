import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpeg from "ffmpeg-static";
import { cardThumbnail, inspectMedia, renderCard, renderReel } from "../lib/exhibition/render.ts";
import { parseCreationInput } from "../lib/exhibition/contract.ts";

test("uploaded playlists cannot trigger remote media fetches", async () => {
  await assert.rejects(inspectMedia(Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nhttp://127.0.0.1:9/private\n")));
});

function silentWav() {
  const length = 24000 * 2;
  const buffer = Buffer.alloc(44 + length);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + length, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(length, 40);
  return buffer;
}

test("local rendering produces vertical reels, exact-text narration, and image thumbnails without BGM", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "postalk-render-test-"));
  try {
    const source = path.join(directory, "source.png");
    await promisify(execFile)(ffmpeg!, ["-y", "-f", "lavfi", "-i", "color=c=orange:s=360x640", "-frames:v", "1", source]);
    const bytes = await readFile(source);
    const card = await renderCard(bytes, "메뉴 이름", "가게의 메뉴를 소개해요.");
    const cardInfo = await inspectMedia(card);
    assert.deepEqual([cardInfo.width, cardInfo.height], [1080, 1350]);
    const thumb = await inspectMedia(await cardThumbnail(card));
    assert.deepEqual([thumb.width, thumb.height], [360, 450]);
    const input = parseCreationInput({ creationId: "11111111-1111-4111-8111-111111111111", format: "reels", conceptId: "external", storeDescription: "가게", menus: [{ id: "menu", name: "메뉴", description: "설명" }],
      template: { id: "external", version: "1", usesSubtitles: false, scenes: [{ sceneNumber: 1, target: "메뉴", menuId: "menu", mediaType: "image", durationSeconds: 1 }] } });
    let speechCalls = 0;
    const silent = await renderReel(input, async () => bytes, [], async () => {}, async () => { speechCalls++; return silentWav(); });
    const silentInfo = await inspectMedia(silent.video);
    assert.deepEqual([silentInfo.width, silentInfo.height], [720, 1280]);
    assert.equal(silentInfo.hasAudio, false);
    assert.equal(speechCalls, 0);
    input.template.usesSubtitles = true;
    const subtitle = "직접 수정한 자막";
    const spoken = await renderReel(input, async () => bytes, [{ sceneNumber: 1, text: subtitle }], async () => {}, async text => {
      assert.equal(text, subtitle); speechCalls++; return silentWav();
    });
    assert.equal(speechCalls, 1);
    const spokenInfo = await inspectMedia(spoken.video);
    assert.equal(spokenInfo.hasAudio, true);
    assert.deepEqual([spokenInfo.width, spokenInfo.height], [720, 1280]);
    const reelThumb = await inspectMedia(spoken.thumbnail);
    assert.deepEqual([reelThumb.width, reelThumb.height], [360, 640]);
  } finally {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "postalk-render-test-")));
    await rm(directory, { recursive: true, force: true });
  }
});

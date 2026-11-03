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

test("local rendering produces vertical captioned reels and image thumbnails without audio", async () => {
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
    const silent = await renderReel(input, async () => bytes, [], async () => {});
    const silentInfo = await inspectMedia(silent.video);
    assert.deepEqual([silentInfo.width, silentInfo.height], [720, 1280]);
    assert.equal(silentInfo.hasAudio, false);
    input.template.usesSubtitles = true;
    const subtitle = "직접 수정한 자막";
    const captioned = await renderReel(input, async () => bytes, [{ sceneNumber: 1, text: subtitle }], async () => {});
    const captionedInfo = await inspectMedia(captioned.video);
    assert.equal(captionedInfo.hasAudio, false);
    assert.deepEqual([captionedInfo.width, captionedInfo.height], [720, 1280]);
    const reelThumb = await inspectMedia(captioned.thumbnail);
    assert.deepEqual([reelThumb.width, reelThumb.height], [360, 640]);
  } finally {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "postalk-render-test-")));
    await rm(directory, { recursive: true, force: true });
  }
});

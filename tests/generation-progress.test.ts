import assert from "node:assert/strict";
import test from "node:test";

import { getGenerationContentType, getGenerationProgress } from "../lib/generation/progress.ts";

test("uses exact provider progress when current and total are available", () => {
  assert.deepEqual(getGenerationProgress("processing", { stage: "rendering", current: 2, total: 4, message: "2번째 장면" }), {
    percent: 50, estimated: false, stage: "rendering", message: "2번째 장면",
  });
});

test("marks missing provider progress as an estimate", () => {
  assert.deepEqual(getGenerationProgress("processing", null), {
    percent: 50, estimated: true, stage: "processing", message: "생성 작업을 처리하고 있어요.",
  });
});

test("returns terminal job progress", () => {
  assert.equal(getGenerationProgress("completed", { current: 1, total: 4 }).percent, 100);
  assert.equal(getGenerationProgress("queued", null).percent, 0);
  assert.equal(getGenerationProgress("failed", null).percent, 0);
});

test("classifies Postalk reels as reels", () => {
  assert.equal(getGenerationContentType("postalk-reels"), "reels");
  assert.equal(getGenerationContentType("gpt-image-2"), "cardNews");
});

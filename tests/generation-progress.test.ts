import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createProgressReporter, GENERATION_STAGES, getGenerationContentType, getGenerationProgress } from "../lib/generation/progress.ts";

test("uses exact provider progress when current and total are available", () => {
  assert.deepEqual(getGenerationProgress("processing", { stage: "rendering", current: 2, total: 4, message: "2번째 장면" }), {
    percent: 50, estimated: false, stage: "rendering", message: "2번째 장면",
  });
});

test("marks missing provider progress as an estimate", () => {
  assert.deepEqual(getGenerationProgress("processing", null), {
    percent: 10, estimated: true, stage: "processing", message: "생성 작업을 준비하고 있어요.",
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

test("weighted progress preserves the estimate flag and reserves 100 for completed jobs", () => {
  for (const [stage, progress] of Object.entries(GENERATION_STAGES)) {
    const actual = getGenerationProgress("processing", { ...progress, stage, estimated: true });
    assert.equal(actual.percent, Math.min(progress.percent, 99));
    assert.equal(actual.estimated, true);
  }
  assert.equal(getGenerationProgress("processing", { current: 3, total: 3 }).percent, 99);
  assert.equal(getGenerationProgress("completed", { percent: 95, estimated: true }).percent, 100);
});

test("progress writes are monotonic, deduplicated, and restricted to processing jobs", async () => {
  const updates: object[] = [];
  const client = { from(table: string) {
    assert.equal(table, "generation_jobs");
    return { update(value: object) {
      return { eq(key: string, id: string) {
        assert.deepEqual([key, id], ["id", "job"]);
        return { async eq(field: string, status: string) {
          assert.deepEqual([field, status], ["status", "processing"]);
          updates.push(value);
          return { error: null };
        } };
      } };
    } };
  } } as unknown as SupabaseClient;
  const report = createProgressReporter(client, "job");
  await report("preparing");
  await report("scripting");
  await report("scripting");
  await report("preparing");
  await report("uploading");
  await report("rendering");
  await report("saving");
  assert.deepEqual(updates, ["preparing", "scripting", "uploading", "saving"].map(stage => ({
    progress: { ...GENERATION_STAGES[stage as keyof typeof GENERATION_STAGES], stage, estimated: true },
  })));
});

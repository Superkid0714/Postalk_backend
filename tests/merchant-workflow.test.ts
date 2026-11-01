import assert from "node:assert/strict";
import test from "node:test";
import { pickAssetsForInstagram } from "../lib/instagram/publish.ts";
import { requireInternalWorkerKey } from "../lib/auth/internal-worker.ts";
import { requireStoreAccess } from "../lib/auth/store-access.ts";
import { generationConflictResponse } from "../lib/generation/conflict.ts";
import { getSubmissionStatusLabel, getSubmissionStatusMessage } from "../lib/submissions/home.ts";
import { isArchiveStatus } from "../lib/archive.ts";
import { POST as publishPhoto } from "../app/api/publish-requests/route.ts";
import { POST as publishVideo } from "../app/api/video-publish-requests/route.ts";

const ID = "11111111-1111-4111-8111-111111111111";
type Submission = Parameters<typeof pickAssetsForInstagram>[0];

function submission(model: string, type = "generated_video", status = "completed"): Submission {
  return {
    id: ID, status: "draft", caption: "가게 소개", hashtags: [], target_menu_name: "떡볶이", appeal_point: "매콤해요",
    extra_message: null, ai_metadata: {},
    generation_jobs: [{ id: "job", status, model_name: model, style_preset: "market_story", result_asset_id: "asset", result_storage_bucket: "uploads", result_file_path: "video.mp4", result_payload: {}, created_at: "2026-11-02T00:00:00Z" }],
    submission_assets: [{ id: "asset", asset_type: type, storage_bucket: "uploads", file_path: "video.mp4", file_name: "video.mp4", mime_type: "video/mp4", created_at: "2026-11-02T00:00:00Z" }],
  };
}

test("rendered session videos are eligible as videos and never as photos", () => {
  const input = submission("render-quote-video");
  assert.equal(pickAssetsForInstagram(input, "video")?.assets[0].id, "asset");
  assert.equal(pickAssetsForInstagram(input, "photo"), null);
});

test("partial generation assets cannot be published before their job completes", () => {
  for (const status of ["queued", "processing", "failed"]) {
    assert.equal(pickAssetsForInstagram(submission("gpt-image-2", "generated_image", status), "photo"), null);
  }
  const legacyPartial = submission("gpt-image-2", "generated_image");
  legacyPartial.generation_jobs = [];
  assert.equal(pickAssetsForInstagram(legacyPartial, "photo"), null);
});

test("a completed job cannot publish the wrong asset type", () => {
  assert.equal(pickAssetsForInstagram(submission("gpt-image-2"), "photo"), null);
  assert.equal(pickAssetsForInstagram(submission("veo-3.1", "generated_image"), "video"), null);
  assert.ok(pickAssetsForInstagram(submission("gpt-image-2", "generated_image"), "photo"));
});

test("a carousel with missing or duplicate images is not silently published as a partial result", () => {
  const input = submission("gpt-image-2", "generated_image");
  const job = input.generation_jobs![0];
  job.result_payload = { generatedImages: [{ assetId: "asset" }, { assetId: "missing" }] };
  assert.equal(pickAssetsForInstagram(input, "photo"), null);
  job.result_payload = { generatedImages: [{ assetId: "asset" }, { assetId: "asset" }] };
  assert.equal(pickAssetsForInstagram(input, "photo"), null);
});

test("merchant status labels no longer represent operator approval", () => {
  assert.equal(getSubmissionStatusLabel("draft"), "보관 중");
  assert.equal(getSubmissionStatusLabel("published"), "게시 완료");
  assert.match(getSubmissionStatusMessage("draft"), /직접 게시/);
  assert.equal(isArchiveStatus("draft"), true);
  assert.equal(isArchiveStatus("published"), true);
  assert.equal(isArchiveStatus("pending_review"), false);
});

test("operator and worker credentials do not bypass merchant authentication", async () => {
  const credentials: Record<string, string>[] = [{ "x-admin-key": "legacy" }, { "x-admin-api-key": "legacy" }, { "x-internal-worker-key": "worker" }];
  for (const headers of credentials) {
    const response = await requireStoreAccess(new Request("http://localhost", { headers }), { storeId: ID });
    assert.equal(response?.status, 401);
  }
});

test("internal worker requires its dedicated key and rejects operator headers", () => {
  const previous = process.env.INTERNAL_WORKER_API_KEY;
  try {
    process.env.INTERNAL_WORKER_API_KEY = "worker-secret";
    assert.equal(requireInternalWorkerKey(new Request("http://localhost", { headers: { "x-internal-worker-key": "worker-secret" } })), null);
    assert.equal(requireInternalWorkerKey(new Request("http://localhost", { headers: { "x-admin-key": "worker-secret" } }))?.status, 401);
    assert.equal(requireInternalWorkerKey(new Request("http://localhost", { headers: { "x-internal-worker-key": "wrong-secret!" } }))?.status, 401);
    delete process.env.INTERNAL_WORKER_API_KEY;
    assert.equal(requireInternalWorkerKey(new Request("http://localhost"))?.status, 503);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_WORKER_API_KEY;
    else process.env.INTERNAL_WORKER_API_KEY = previous;
  }
});

test("merchant publish endpoints reject malformed and unauthenticated requests before external calls", async () => {
  for (const publish of [publishPhoto, publishVideo]) {
    const invalid = await publish(new Request("http://localhost", { method: "POST", body: JSON.stringify({ submissionId: 123 }) }));
    assert.equal(invalid.status, 400);
    const missingAuth = await publish(new Request("http://localhost", { method: "POST", body: JSON.stringify({ submissionId: ID }) }));
    assert.equal(missingAuth.status, 401);
  }
});

test("a unique active-job collision returns conflict rather than a server failure", () => {
  assert.equal(generationConflictResponse({ code: "23505" })?.status, 409);
  assert.equal(generationConflictResponse({ code: "other" }), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/uploads/route.ts";
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_REQUEST_SIZE } from "../lib/upload-limits.ts";

test("video uploads larger than 50 MiB are rejected before storage access", async () => {
  const form = new FormData();
  form.set("assetType", "video_clip");
  form.set("file", new Blob([new Uint8Array(MAX_UPLOAD_FILE_SIZE.video_clip + 1)], { type: "video/mp4" }), "clip.mp4");

  const response = await POST(new Request("http://localhost/api/uploads", { method: "POST", body: form }) as never);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("uploads reject oversized requests and malformed multipart as JSON errors", async () => {
  const uploadUrl = "http://localhost/api/uploads";
  const oversized = await POST(new Request(uploadUrl, {
    method: "POST",
    headers: { "content-length": String(MAX_UPLOAD_REQUEST_SIZE + 1) },
  }) as never);
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "PAYLOAD_TOO_LARGE");

  const malformed = await POST(new Request(uploadUrl, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=fixture" },
    body: "--fixture",
  }) as never);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "VALIDATION_ERROR");
});

import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/uploads/route.ts";

test("video uploads larger than 50 MiB are rejected before storage access", async () => {
  const form = new FormData();
  form.set("assetType", "video_clip");
  form.set("file", new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: "video/mp4" }), "clip.mp4");

  const response = await POST(new Request("http://localhost/api/uploads", { method: "POST", body: form }) as never);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
});

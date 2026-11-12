import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/openapi/route.ts";
import { openApiDocument } from "../lib/openapi.ts";

test("OpenAPI 문서는 게스트 제작 흐름의 핵심 경로를 제공한다", async () => {
  assert.equal(openApiDocument.openapi, "3.0.3");
  assert.ok(openApiDocument.paths["/api/guest-session"]?.post);
  assert.ok(openApiDocument.paths["/api/ad-sessions/start"]?.post);
  assert.ok(openApiDocument.paths["/api/generation-jobs/{jobId}/progress"]?.get);

  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  const body = await response.json();
  assert.equal(body.info.title, "POSTALK Frontend API");
});

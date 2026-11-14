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

test("프론트 조회 및 제출 API는 Swagger에 구체적인 200 응답과 예시를 제공한다", async () => {
  const { paths } = await GET().json();
  const endpoints = [
    ["/api/ad-sessions/{sessionId}", "get", ["photoCompleted", "videoCompleted", "collecting"]],
    ["/api/archive", "get", ["photoArchive"]],
    ["/api/home", "get", ["home"]],
    ["/api/ad-sessions/{sessionId}/photos", "post", ["nextShot", "generationStarted", "retake"]],
    ["/api/ad-sessions/{sessionId}/videos", "post", ["nextShot", "generationStarted"]],
  ] as const;

  for (const [path, method, cases] of endpoints) {
    const { schema, examples } = paths[path][method].responses["200"].content["application/json"];
    const dataSchema = schema.properties.data;
    const dataVariants = dataSchema.oneOf ?? [dataSchema];
    assert.ok(dataVariants.every((variant: { required?: string[] }) => variant.required?.length), path);
    for (const name of cases) {
      assert.equal(examples[name].value.success, true);
      assert.ok(dataVariants.some((variant: { required: string[] }) =>
        variant.required.every((key) => Object.hasOwn(examples[name].value.data, key))), `${path} ${name}`);
    }
  }

  const photos = paths["/api/ad-sessions/{sessionId}/photos"].post.responses["200"]
    .content["application/json"].examples;
  assert.equal(photos.retake.value.data.response, "fail");
  assert.ok(photos.retake.value.data.retryMessage);
  assert.ok(photos.generationStarted.value.data.generationJobId);
});

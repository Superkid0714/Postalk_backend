import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { GET, POST } from "../app/api/exhibition/uploads/route.ts";
import { GET as listAds } from "../app/api/exhibition/ads/route.ts";
import { ExhibitionError } from "../lib/exhibition/contract.ts";
import { exhibitionMediaPolicy, readUploadForm } from "../lib/exhibition/media-policy.ts";
import { buildUsageReport } from "../scripts/report-media-usage.mjs";

test("exhibition uploads enforce bounded requests and avoid redundant or oversized storage writes", async (t) => {
  const values = { EXHIBITION_MODE_ENABLED: "true", EXHIBITION_STORE_ID: "11111111-1111-4111-8111-111111111111", NEXT_PUBLIC_SUPABASE_URL: "https://upload-test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only-key", MEDIA_STORAGE_PROVIDER: "supabase" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  let existing = false;
  let uploadStatus = 200;
  let uploadMessage = "";
  let thumbnail: string | null = null;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, "upload-test.invalid");
    calls.push(url.pathname);
    if (url.pathname.endsWith("/contents")) {
      assert.equal(url.searchParams.get("store_id"), `eq.${values.EXHIBITION_STORE_ID}`);
      if (!url.searchParams.has("creation_id")) return Response.json([{ id: "ad", job_id: "job", format: "card_news", concept_id: "team", publish_status: "unpublished" }], { headers: { "content-range": "0-0/1" } });
      assert.equal(url.searchParams.get("creation_id"), "eq.22222222-2222-4222-8222-222222222222");
      return Response.json(existing ? [{ id: "existing-ad" }] : []);
    }
    if (url.pathname.endsWith("/generation_jobs")) return Response.json([{ id: "job", submission_id: "ad", status: "completed", result_storage_bucket: "uploads", result_payload: { thumbnailFilePath: thumbnail, generatedImages: [{ filePath: "large-card.png" }] } }]);
    if (url.pathname.endsWith("/submissions")) return Response.json([{ id: "ad", title: "카드뉴스" }]);
    if (url.pathname.startsWith("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/uploads/thumb.jpg?token=test" });
    if (url.pathname.startsWith("/storage/v1/object/")) return Response.json(uploadStatus === 200 ? { Key: "uploaded-object" } : { message: uploadMessage, statusCode: String(uploadStatus), error: uploadMessage }, { status: uploadStatus });
    if (url.pathname.endsWith("/rpc/register_exhibition_upload")) return Response.json({});
    throw new Error(`Unexpected mocked request: ${url.pathname}`);
  };
  const formRequest = (file: File) => {
    const body = new FormData();
    body.set("user_id", "1"); body.set("creationId", "22222222-2222-4222-8222-222222222222"); body.set("sceneNumber", "1"); body.set("file", file);
    return new Request("http://localhost/api/exhibition/uploads", { method: "POST", body });
  };
  try {
    await t.test("frontend receives the same 50 MiB video policy used by the route", async () => {
      const response = await GET(new Request("http://localhost/api/exhibition/uploads?user_id=1"));
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.data.video.maxBytes, 52428800);
      assert.equal(result.data.image.maxBytes, 10485760);
    });
    await t.test("oversized declared requests fail before database or storage access", async () => {
      calls.length = 0;
      const response = await POST(new Request("http://localhost/api/exhibition/uploads", { method: "POST", body: "small", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(exhibitionMediaPolicy.maxRequestBytes + 1) } }));
      assert.equal(response.status, 413);
      assert.equal(calls.length, 0);
    });
    await t.test("chunked uploads without Content-Length are stopped at the actual byte limit", async () => {
      let produced = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(controller) { produced++; controller.enqueue(new Uint8Array(256).fill(97)); if (produced >= 100) controller.close(); } });
      const request = new Request("http://localhost/upload", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=test" }, duplex: "half" } as RequestInit & { duplex: string });
      await assert.rejects(readUploadForm(request, 1024), error => error instanceof ExhibitionError && error.status === 413);
      assert.ok(produced < 100);
    });
    await t.test("multiple files and over-limit images never reach storage", async () => {
      calls.length = 0;
      const tooBig = new File([new Uint8Array(exhibitionMediaPolicy.image.maxBytes + 1)], "large.png", { type: "image/png" });
      assert.equal((await POST(formRequest(tooBig))).status, 413);
      const body = new FormData(); body.append("file", new File(["a"], "a.png")); body.append("file", new File(["b"], "b.png"));
      assert.equal((await POST(new Request("http://localhost/upload", { method: "POST", body }))).status, 400);
      assert.equal(calls.length, 0);
    });
    await t.test("a submitted creation is rejected before media inspection or another upload", async () => {
      existing = true; calls.length = 0;
      assert.equal((await POST(formRequest(new File(["not-even-a-photo"], "a.png", { type: "image/png" })))).status, 409);
      assert.equal(calls.length, 1);
      existing = false;
    });
    const { stdout } = await promisify(execFile)(ffmpeg!, ["-y", "-f", "lavfi", "-i", "color=c=orange:s=32x32", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], { encoding: "buffer", windowsHide: true });
    const photo = () => new File([new Uint8Array(stdout)], "photo.png", { type: "image/png" });
    await t.test("successful upload registers the file while provider limits return actionable errors", async () => {
      calls.length = 0;
      assert.equal((await POST(formRequest(photo()))).status, 201);
      assert.ok(calls.some(call => call.endsWith("/rpc/register_exhibition_upload")));
      for (const [status, message, expected] of [[413, "Payload too large", 413], [403, "Storage quota exceeded", 507], [429, "Too many requests", 429]] as const) {
        uploadStatus = status; uploadMessage = message; calls.length = 0;
        const response = await POST(formRequest(photo()));
        assert.equal(response.status, expected);
        assert.ok(!calls.some(call => call.endsWith("/rpc/register_exhibition_upload")));
      }
    });
    await t.test("usage report distinguishes registered bytes, unknown sizes and cleanup candidates", () => {
      const report = buildUsageReport([{ provider: "supabase", bytes: 40e9, objects: 100, unknown_size_objects: 2, unreferenced_objects: 3 }, { provider: "supabase", bytes: "31000000000", objects: 200 }]);
      assert.equal(report.registeredGB, 71);
      assert.equal(report.storageWarning, true);
      assert.equal(report.unknownSizeObjects, 2);
      assert.equal(report.unreferencedCandidates, 3);
      assert.equal(buildUsageReport([{ provider: "external", bytes: 100e9 }]).storageWarning, false);
    });
    await t.test("archive signs only dedicated thumbnails and never falls back to the full card", async () => {
      calls.length = 0;
      const empty = await (await listAds(new Request("http://localhost/api/exhibition/ads?user_id=1"))).json();
      assert.equal(empty.data.items[0].thumbnailUrl, null);
      assert.ok(!calls.some(call => call.startsWith("/storage/")));
      thumbnail = "thumb.jpg"; calls.length = 0;
      const populated = await (await listAds(new Request("http://localhost/api/exhibition/ads?user_id=1"))).json();
      assert.match(populated.data.items[0].thumbnailUrl, /thumb\.jpg/);
      assert.ok(calls.some(call => call.includes("/object/sign/uploads/thumb.jpg")));
      assert.ok(!calls.some(call => call.includes("large-card.png")));
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

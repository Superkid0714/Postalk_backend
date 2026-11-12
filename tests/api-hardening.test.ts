import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { validateRequestBody } from "../lib/api/request-body.ts";
import { requireStoreAccess } from "../lib/auth/store-access.ts";
import { resolveActivatedStoreFromQrToken } from "../lib/merchant-qr.ts";
import { isStoreUploadPath, verifyStoreUpload } from "../lib/files/verify-upload.ts";
import { withGenerationJobLease } from "../lib/generation/job-lease.ts";
import { POST as startSession } from "../app/api/ad-sessions/start/route.ts";
import { POST as submit } from "../app/api/submissions/route.ts";
import { sanitizeFileName } from "../lib/files.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const path = `stores/${STORE}/food_photo/asset-id/photo.png`;

function merchantClient(status = "activated", resourceStore = STORE, failure = false) {
  return { from(table: string) {
    const result = table === "merchant_qr_tokens"
      ? { qr_token: "secret", status, assigned_store_id: STORE }
      : table === "stores" ? { id: STORE } : { store_id: resourceStore };
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, async maybeSingle() {
      return { data: failure ? null : result, error: failure ? { message: "offline" } : null };
    } };
    return query;
  } } as unknown as SupabaseClient;
}

test("malformed values are rejected before invoking string or array methods", () => {
  for (const body of [null, [], 5, { menuIntro: 123 }, { caption: false }, { assets: {} }, { assets: [null] }, { hashtags: [1] }, { fileSize: -1 }, { durationSeconds: Infinity }, { mockMode: "true" }]) {
    assert.throws(() => validateRequestBody(body));
  }
  assert.doesNotThrow(() => validateRequestBody({ caption: null, assets: [{ assetType: "food_photo", filePath: path }], hashtags: ["시장"] }));
  assert.throws(() => validateRequestBody({ assets: [{ assetType: "generated_image", filePath: path }] }));
  assert.throws(() => validateRequestBody({ aiMetadata: { videoWorkflow: { resultFilePath: "other-store/file.mp4" } } }));
});

test("malformed session and submission bodies produce 400 without accessing a database", async () => {
  for (const handler of [startSession, submit]) {
    for (const body of [null, { menuIntro: 123 }, { assets: [null] }]) {
      const response = await handler(new NextRequest("http://localhost/api/test", { method: "POST", body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
    }
  }
});

test("merchant access rejects missing credentials, foreign stores and foreign resources", async () => {
  assert.equal((await requireStoreAccess(new Request("http://localhost"), { storeId: STORE }))?.status, 401);
  const request = new Request("http://localhost", { headers: { "x-merchant-qr-token": "secret" } });
  assert.equal(await requireStoreAccess(request, { storeId: STORE }, undefined, merchantClient()), null);
  assert.equal((await requireStoreAccess(request, { storeId: OTHER }, undefined, merchantClient()))?.status, 403);
  for (const resource of [{ sessionId: OTHER }, { jobId: OTHER }, { submissionId: OTHER }]) {
    assert.equal((await requireStoreAccess(request, resource, undefined, merchantClient("activated", OTHER)))?.status, 403);
  }
});

test("ready and disabled QR tokens cannot authenticate even when assigned to a store", async () => {
  for (const status of ["ready", "disabled"]) {
    assert.equal((await resolveActivatedStoreFromQrToken(merchantClient(status), "secret")).store, null);
    assert.equal((await requireStoreAccess(new Request("http://localhost"), { storeId: STORE }, "secret", merchantClient(status)))?.status, 401);
  }
  assert.equal(await requireStoreAccess(new Request("http://localhost"), { storeId: STORE }, "secret", merchantClient()), null);
});

test("credential storage failure fails closed", async () => {
  assert.equal((await requireStoreAccess(new Request("http://localhost"), { storeId: STORE }, "secret", merchantClient("activated", STORE, true)))?.status, 503);
});

test("file references reject other stores, buckets, generated paths, traversal and media mismatches", () => {
  assert.equal(isStoreUploadPath("uploads", path, STORE, "food_photo"), true);
  for (const [bucket, filePath] of [["private", path], ["uploads", path.replace(STORE, OTHER)], ["uploads", `stores/${STORE}/../asset/photo.png`], ["uploads", path.replace("photo.png", "%2e%2e")], ["uploads", path.replace("photo.png", "..\\photo.png")], ["uploads", `${STORE}/submission/generated/image.png`]]) {
    assert.equal(isStoreUploadPath(bucket, filePath, STORE), false);
  }
  assert.equal(isStoreUploadPath("uploads", path, STORE, "video_clip"), false);
  assert.equal(sanitizeFileName("photo.png/evil"), "photo");
});

test("file verification requires the exact uploaded object to exist", async () => {
  const client = (files: Array<{ name: string; id: string }>, error: object | null = null) => ({ storage: { from: () => ({ list: async () => ({ data: files, error }) }) } }) as unknown as SupabaseClient;
  assert.equal(await verifyStoreUpload(client([{ name: "photo.png", id: "object" }]), STORE, { filePath: path }), null);
  assert.equal((await verifyStoreUpload(client([{ name: "photo.png-other", id: "object" }]), STORE, { filePath: path }))?.status, 400);
  assert.equal((await verifyStoreUpload(client([], {}), STORE, { filePath: path }))?.status, 503);
});

test("two simultaneous processors run expensive work once and release the lease", async () => {
  let locked = false;
  let runs = 0;
  let releases = 0;
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const client = {
    async rpc() { if (locked) return { data: false, error: null }; locked = true; return { data: true, error: null }; },
    from: () => ({ delete: () => ({ eq: () => ({ eq: async () => { releases++; locked = false; return { error: null }; } }) }) }),
  } as unknown as SupabaseClient;
  const first = withGenerationJobLease(STORE, async () => { runs++; await blocked; return { status: "completed" }; }, client);
  const second = await withGenerationJobLease(STORE, async () => { runs++; }, client);
  assert.equal(second?.status, "processing");
  finish();
  await first;
  assert.equal(runs, 1);
  assert.equal(releases, 1);
});

test("failed processors release their lease, and claim errors never run work", async () => {
  let releases = 0;
  let runs = 0;
  const client = {
    rpc: async () => ({ data: true, error: null }),
    from: () => ({ delete: () => ({ eq: () => ({ eq: async () => { releases++; return { error: null }; } }) }) }),
  } as unknown as SupabaseClient;
  await assert.rejects(withGenerationJobLease(STORE, async () => { throw new Error("provider failed"); }, client), /provider failed/);
  assert.equal(releases, 1);
  const offline = { rpc: async () => ({ data: null, error: { message: "offline" } }) } as unknown as SupabaseClient;
  await assert.rejects(withGenerationJobLease(STORE, async () => { runs++; }, offline), /offline/);
  assert.equal(runs, 0);
});

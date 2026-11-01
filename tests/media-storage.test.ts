import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getMediaStorage, getUploadStorageBucket, readMediaStorageConfig, resolveMediaBucket, mediaObjectExists, type StorageDependencies } from "../lib/storage/media.ts";

const config = readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "s3", AWS_S3_BUCKET: "postalk-media-test", AWS_REGION: "ap-northeast-2" });
const supabase = { storage: { from: (bucket: string) => ({ marker: bucket }) } } as unknown as SupabaseClient;

test("S3 writes do not reinterpret existing Supabase file references", () => {
  assert.equal(getUploadStorageBucket(config), "s3:postalk-media-test");
  assert.equal(getUploadStorageBucket(readMediaStorageConfig({})), "uploads");
  assert.deepEqual(resolveMediaBucket("uploads", config), { provider: "supabase", bucket: "uploads" });
  assert.deepEqual(getMediaStorage(supabase, { config }).from("uploads"), { marker: "uploads" });
  assert.throws(() => resolveMediaBucket("s3:someone-else", config));
  assert.throws(() => readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "s3" }));
  assert.throws(() => readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "unknown" }));
});

test("old S3 buckets remain readable after changing the upload provider or write bucket", () => {
  const rollback = readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "supabase", AWS_REGION: "ap-northeast-2", AWS_S3_READ_BUCKETS: "postalk-old-media" });
  assert.equal(getUploadStorageBucket(rollback), "uploads");
  assert.equal(resolveMediaBucket("s3:postalk-old-media", rollback).provider, "s3");
});

test("S3 uploads preserve MIME type and use conditional writes to prevent overwrites", async () => {
  const commands: PutObjectCommand[] = [];
  const deps: StorageDependencies = { config, s3: { send: async (command: PutObjectCommand) => { commands.push(command); return {}; } } as StorageDependencies["s3"] };
  const storage = getMediaStorage(supabase, deps).from("s3:postalk-media-test");
  const result = await storage.upload("stores/id/photo.png", new Uint8Array([1, 2]), { contentType: "image/png", upsert: false });
  assert.equal(result.error, null);
  assert.ok(commands[0] instanceof PutObjectCommand);
  assert.equal(commands[0].input.Bucket, "postalk-media-test");
  assert.equal(commands[0].input.IfNoneMatch, "*");
  assert.equal(commands[0].input.ContentType, "image/png");
  await storage.upload("generated/image.png", new Uint8Array([3]), { upsert: true });
  assert.equal(commands[1].input.IfNoneMatch, undefined);
});

test("S3 downloads and private signed URLs support existing callers", async () => {
  let signedCommand: GetObjectCommand | undefined;
  const deps: StorageDependencies = {
    config,
    s3: { send: async (command: GetObjectCommand) => {
      assert.ok(command instanceof GetObjectCommand);
      return { Body: { transformToByteArray: async () => new Uint8Array([7, 8]) }, ContentType: "video/mp4" };
    } } as StorageDependencies["s3"],
    sign: (async (_client, command, options) => {
      signedCommand = command as unknown as GetObjectCommand;
      assert.equal(options?.expiresIn, 3600);
      return "https://s3.example/private?signature=test";
    }) as StorageDependencies["sign"],
  };
  const storage = getMediaStorage(supabase, deps).from("s3:postalk-media-test");
  const downloaded = await storage.download("clip.mp4");
  assert.equal(downloaded.data?.type, "video/mp4");
  assert.deepEqual(new Uint8Array(await downloaded.data!.arrayBuffer()), new Uint8Array([7, 8]));
  assert.equal((await storage.createSignedUrl("clip.mp4", 3600)).error, null);
  assert.equal(signedCommand?.input.Key, "clip.mp4");
  assert.ok((await storage.createSignedUrl("clip.mp4", 604801)).error);
});

test("S3 object validation treats 404 as missing and 403 as a storage failure", async () => {
  const client = (status?: number) => ({ send: async (command: HeadObjectCommand) => {
    assert.ok(command instanceof HeadObjectCommand);
    if (status) throw Object.assign(new Error("Storage denied"), { $metadata: { httpStatusCode: status } });
    return {};
  } }) as StorageDependencies["s3"];
  assert.equal((await mediaObjectExists(supabase, "s3:postalk-media-test", "file", { config, s3: client() })).data, true);
  const missing = await mediaObjectExists(supabase, "s3:postalk-media-test", "file", { config, s3: client(404) });
  assert.equal(missing.data, false);
  assert.equal(missing.error, null);
  assert.ok((await mediaObjectExists(supabase, "s3:postalk-media-test", "file", { config, s3: client(403) })).error);
});

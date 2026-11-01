import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

export function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export function parseMigrationArgs(args: string[]) {
  let mode = "plan";
  let apply = false;
  let limit = Number.POSITIVE_INFINITY;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--mode") mode = args[++index];
    else if (args[index] === "--apply") apply = true;
    else if (args[index] === "--limit") {
      limit = Number(args[++index]);
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
    } else throw new Error(`Unknown option: ${args[index]}`);
  }
  if (!["plan", "copy", "promote", "rollback"].includes(mode)) throw new Error("Invalid migration mode");
  if (mode !== "plan" && !apply) throw new Error("Writes require --apply; use --mode plan to inspect first");
  return { mode, limit };
}

async function* sourceObjects(supabase: SupabaseClient, prefix = ""): AsyncGenerator<string> {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from("uploads").list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const key = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) yield key;
      else yield* sourceObjects(supabase, key);
    }
    if (!data || data.length < 1000) break;
  }
}

async function verifyTarget(s3: S3Client, bucket: string, key: string, digest: string, size: number, contentType: string) {
  const target = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!target.Body) throw new Error("Target S3 object has no body");
  const bytes = await target.Body.transformToByteArray();
  if (bytes.byteLength !== size || sha256(bytes) !== digest) throw new Error(`Target checksum mismatch: ${key}`);
  if (contentType && target.ContentType !== contentType) throw new Error(`Target MIME type mismatch: ${key}`);
}

async function main() {
  const options = parseMigrationArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!url || !serviceKey) throw new Error("Supabase server credentials are required");
  if (options.mode !== "plan" && (!bucket || !region)) throw new Error("AWS_S3_BUCKET and AWS_REGION are required");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const s3 = new S3Client({ region, maxAttempts: 3 });
  const directory = path.resolve("migration-reports");
  await mkdir(directory, { recursive: true });
  const report = path.join(directory, `${Date.now()}-${options.mode}.jsonl`);
  let count = 0;
  for await (const key of sourceObjects(supabase)) {
    if (count >= options.limit) break;
    count++;
    if (options.mode === "plan") {
      await appendFile(report, JSON.stringify({ source: "uploads", key, target: bucket ? `s3:${bucket}` : null }) + "\n");
      continue;
    }
    const { data, error } = await supabase.storage.from("uploads").download(key);
    if (error || !data) throw new Error(error?.message ?? `Source object missing: ${key}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const digest = sha256(bytes);
    if (options.mode === "copy") {
      let exists = true;
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
        exists = false;
      }
      if (!exists) {
        try {
          await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: data.type,
            IfNoneMatch: "*", ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"), Metadata: { "source-provider": "supabase", sha256: digest } }));
        } catch (error) {
          if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
        }
      }
    }
    // Copy, promotion, and rollback all verify bytes on both providers before changing references.
    await verifyTarget(s3, bucket!, key, digest, bytes.byteLength, data.type);
    let remapped: unknown = null;
    if (options.mode === "promote" || options.mode === "rollback") {
      const { data: result, error: remapError } = await supabase.rpc("remap_media_storage_reference", {
        p_from: options.mode === "promote" ? "uploads" : `s3:${bucket}`,
        p_to: options.mode === "promote" ? `s3:${bucket}` : "uploads",
        p_file_path: key,
      });
      if (remapError) throw new Error(remapError.message);
      remapped = result;
    }
    await appendFile(report, JSON.stringify({ key, sha256: digest, bytes: bytes.byteLength, mode: options.mode, remapped }) + "\n");
  }
  console.log(JSON.stringify({ mode: options.mode, objects: count, report }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

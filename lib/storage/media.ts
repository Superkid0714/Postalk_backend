import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaStorageConfig = {
  provider: "supabase" | "s3";
  region?: string;
  bucket?: string;
  readBuckets: string[];
};

export function readMediaStorageConfig(env: Record<string, string | undefined> = process.env): MediaStorageConfig {
  const provider = env.MEDIA_STORAGE_PROVIDER?.trim() || "supabase";
  if (provider !== "supabase" && provider !== "s3") throw new Error("Invalid MEDIA_STORAGE_PROVIDER");
  const bucket = env.AWS_S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  const readBuckets = [...new Set([bucket, ...(env.AWS_S3_READ_BUCKETS || "").split(",").map(value => value.trim())].filter((value): value is string => Boolean(value)))];
  for (const name of readBuckets) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) || name.includes("..")) throw new Error("Invalid S3 bucket name");
  }
  if (provider === "s3" && (!bucket || !region)) throw new Error("AWS_S3_BUCKET and AWS_REGION are required for S3 writes");
  return { provider, bucket, region, readBuckets };
}

// Plain references always keep pointing to Supabase, even after S3 writes are enabled.
// Persist the returned reference with every new asset/job; never infer old providers from an env toggle.
export function getUploadStorageBucket(config = readMediaStorageConfig()) {
  return config.provider === "s3" ? `s3:${config.bucket}` : "uploads";
}

export function resolveMediaBucket(reference: string, config = readMediaStorageConfig()) {
  if (!reference.startsWith("s3:")) return { provider: "supabase" as const, bucket: reference };
  const bucket = reference.slice(3);
  if (!config.readBuckets.includes(bucket)) throw new Error("S3 bucket is not configured for this application");
  if (!config.region) throw new Error("AWS_REGION is required to read S3 objects");
  return { provider: "s3" as const, bucket };
}

function storageError(error: unknown) {
  return { message: error instanceof Error ? error.message : "Media storage request failed" };
}

let s3Client: S3Client | undefined;
let s3Region: string | undefined;
function defaultS3Client(region: string) {
  if (!s3Client || s3Region !== region) {
    const options: S3ClientConfig = { region, maxAttempts: 3 };
    s3Client = new S3Client(options); // Use the standard credential chain, including task/instance roles.
    s3Region = region;
  }
  return s3Client;
}

export type StorageDependencies = {
  config?: MediaStorageConfig;
  s3?: Pick<S3Client, "send">;
  sign?: typeof getSignedUrl;
};

export function getMediaStorage(supabase: SupabaseClient, deps: StorageDependencies = {}) {
  const config = deps.config ?? readMediaStorageConfig();
  return { from(reference: string) {
    const target = resolveMediaBucket(reference, config);
    if (target.provider === "supabase") return supabase.storage.from(target.bucket);
    const client = deps.s3 ?? defaultS3Client(config.region!);
    const Bucket = target.bucket;
    return {
      async upload(key: string, bytes: Uint8Array, options?: { contentType?: string; upsert?: boolean }) {
        try {
          await client.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes,
            ContentType: options?.contentType, IfNoneMatch: options?.upsert ? undefined : "*" }));
          return { data: { path: key }, error: null };
        } catch (error) { return { data: null, error: storageError(error) }; }
      },
      async download(key: string) {
        try {
          const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
          if (!result.Body) throw new Error("S3 object body is missing");
          const bytes = await result.Body.transformToByteArray();
          return { data: new Blob([new Uint8Array(bytes)], { type: result.ContentType }), error: null };
        } catch (error) { return { data: null, error: storageError(error) }; }
      },
      async createSignedUrl(key: string, expiresIn: number) {
        try {
          if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604_800) throw new Error("Invalid signed URL lifetime");
          const signedUrl = await (deps.sign ?? getSignedUrl)(client as S3Client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
          return { data: { signedUrl }, error: null };
        } catch (error) { return { data: null, error: storageError(error) }; }
      },
    };
  } };
}

export async function mediaObjectExists(supabase: SupabaseClient, reference: string, key: string, deps: StorageDependencies = {}) {
  try {
    const config = deps.config ?? readMediaStorageConfig();
    const target = resolveMediaBucket(reference, config);
    if (target.provider === "s3") {
      const client = deps.s3 ?? defaultS3Client(config.region!);
      try {
        await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
        return { data: true, error: null };
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return { data: false, error: null };
        throw error;
      }
    }
    const slash = key.lastIndexOf("/");
    const name = key.slice(slash + 1);
    const { data, error } = await supabase.storage.from(target.bucket).list(key.slice(0, slash), { search: name, limit: 100 });
    return { data: Boolean(data?.some(file => file.name === name && file.id)), error };
  } catch (error) { return { data: false, error: storageError(error) }; }
}

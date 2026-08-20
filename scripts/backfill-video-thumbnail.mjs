import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";

async function readEnvFile() {
  const envPath = path.resolve(".env");
  const text = await fs.readFile(envPath, "utf8");
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

async function extractThumbnail(videoBytes) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "postalk-backfill-thumb-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "thumb.jpg");

  try {
    await fs.writeFile(inputPath, videoBytes);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath ?? "ffmpeg", [
        "-y",
        "-ss",
        "0.1",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-update",
        "1",
        outputPath,
      ]);

      let stderr = "";

      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const submissionId = process.argv[2];

  if (!submissionId) {
    throw new Error("Usage: node scripts/backfill-video-thumbnail.mjs <submissionId>");
  }

  const env = await readEnvFile();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: existingThumbnail } = await supabase
    .from("submission_assets")
    .select("id, file_path")
    .eq("submission_id", submissionId)
    .eq("asset_type", "video_thumbnail")
    .limit(1)
    .maybeSingle();

  if (existingThumbnail) {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
          reason: "thumbnail_already_exists",
          thumbnail: existingThumbnail,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { data: videoAsset, error: assetError } = await supabase
    .from("submission_assets")
    .select("submission_id, storage_bucket, file_path, file_name")
    .eq("submission_id", submissionId)
    .eq("asset_type", "generated_video")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assetError || !videoAsset) {
    throw new Error(assetError?.message ?? "Generated video asset not found");
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(videoAsset.storage_bucket)
    .download(videoAsset.file_path);

  if (downloadError || !fileData) {
    throw new Error(downloadError?.message ?? "Failed to download video file");
  }

  const videoBytes = new Uint8Array(await fileData.arrayBuffer());
  const thumbnailBytes = await extractThumbnail(videoBytes);
  const thumbnailPath = videoAsset.file_path.replace(/\.mp4$/i, ".jpg");

  const { error: uploadError } = await supabase.storage
    .from(videoAsset.storage_bucket)
    .upload(thumbnailPath, thumbnailBytes, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: insertedThumbnail, error: insertError } = await supabase
    .from("submission_assets")
    .insert({
      submission_id: submissionId,
      asset_type: "video_thumbnail",
      storage_bucket: videoAsset.storage_bucket,
      file_path: thumbnailPath,
      file_name: videoAsset.file_name.replace(/\.mp4$/i, ".jpg"),
      mime_type: "image/jpeg",
      file_size: thumbnailBytes.byteLength,
      sort_order: 0,
    })
    .select("id, file_path")
    .single();

  if (insertError || !insertedThumbnail) {
    throw new Error(insertError?.message ?? "Failed to insert thumbnail asset");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        submissionId,
        thumbnail: insertedThumbnail,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

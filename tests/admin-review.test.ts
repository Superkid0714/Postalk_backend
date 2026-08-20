import assert from "node:assert/strict";
import test from "node:test";

import { selectReviewDisplayAssets } from "@/lib/admin-review";

test("selectReviewDisplayAssets keeps only generated ad assets", () => {
  const assets = selectReviewDisplayAssets([
    {
      asset_type: "menu_board",
      storage_bucket: "uploads",
      file_path: "stores/a/menu.png",
      sort_order: 0,
      file_name: "menu.png",
      mime_type: "image/png",
      file_size: 100,
    },
    {
      asset_type: "food_photo",
      storage_bucket: "uploads",
      file_path: "stores/a/food.png",
      sort_order: 1,
      file_name: "food.png",
      mime_type: "image/png",
      file_size: 100,
    },
    {
      asset_type: "generated_image",
      storage_bucket: "uploads",
      file_path: "generated/11111111-1111-1111-1111-111111111111-1.png",
      sort_order: 2,
      file_name: "11111111-1111-1111-1111-111111111111-1.png",
      mime_type: "image/png",
      file_size: 100,
      created_at: "2026-08-20T06:00:01.000Z",
    },
    {
      asset_type: "video_thumbnail",
      storage_bucket: "uploads",
      file_path: "generated/a-1.jpg",
      sort_order: 0,
      file_name: "a-1.jpg",
      mime_type: "image/jpeg",
      file_size: 100,
      created_at: "2026-08-20T05:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    assets.map((asset) => asset.asset_type),
    ["generated_image"],
  );
});

test("selectReviewDisplayAssets removes duplicate generated asset entries", () => {
  const assets = selectReviewDisplayAssets([
    {
      asset_type: "generated_video",
      storage_bucket: "uploads",
      file_path: "generated/video.mp4",
      sort_order: 0,
      file_name: "video.mp4",
      mime_type: "video/mp4",
      file_size: 100,
      created_at: "2026-08-20T06:00:01.000Z",
    },
    {
      asset_type: "generated_video",
      storage_bucket: "uploads",
      file_path: "generated/video.mp4",
      sort_order: 1,
      file_name: "video-copy.mp4",
      mime_type: "video/mp4",
      file_size: 100,
      created_at: "2026-08-20T05:59:59.000Z",
    },
    {
      asset_type: "video_thumbnail",
      storage_bucket: "uploads",
      file_path: "generated/video.jpg",
      sort_order: 0,
      file_name: "video.jpg",
      mime_type: "image/jpeg",
      file_size: 100,
      created_at: "2026-08-20T06:00:02.000Z",
    },
  ]);

  assert.deepEqual(
    assets.map((asset) => `${asset.asset_type}:${asset.file_path}`),
    [
      "video_thumbnail:generated/video.jpg",
      "generated_video:generated/video.mp4",
    ],
  );
});

test("selectReviewDisplayAssets keeps only the newest generated image batch", () => {
  const assets = selectReviewDisplayAssets([
    {
      asset_type: "generated_image",
      storage_bucket: "uploads",
      file_path: "generated/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-1.png",
      sort_order: 0,
      file_name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-1.png",
      mime_type: "image/png",
      file_size: 100,
      created_at: "2026-08-20T05:00:00.000Z",
    },
    {
      asset_type: "generated_image",
      storage_bucket: "uploads",
      file_path: "generated/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-2.png",
      sort_order: 1,
      file_name: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-2.png",
      mime_type: "image/png",
      file_size: 100,
      created_at: "2026-08-20T05:00:01.000Z",
    },
    {
      asset_type: "generated_image",
      storage_bucket: "uploads",
      file_path: "generated/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-1.png",
      sort_order: 0,
      file_name: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-1.png",
      mime_type: "image/png",
      file_size: 100,
      created_at: "2026-08-20T06:00:00.000Z",
    },
    {
      asset_type: "generated_image",
      storage_bucket: "uploads",
      file_path: "generated/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-2.png",
      sort_order: 1,
      file_name: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-2.png",
      mime_type: "image/png",
      file_size: 100,
      created_at: "2026-08-20T06:00:01.000Z",
    },
  ]);

  assert.deepEqual(
    assets.map((asset) => asset.file_name),
    [
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-1.png",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb-2.png",
    ],
  );
});

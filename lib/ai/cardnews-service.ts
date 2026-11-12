import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage, getUploadStorageBucket } from "@/lib/storage/media";

export const CARDNEWS_PROVIDER = "postalk-cardnews";
export const CARDNEWS_SHOTS = {
  card_bowl: { role: "bowl", title: "대표 음식 전체", prompt: "그릇 전체가 보이도록 대표 음식을 찍어주세요." },
  card_zoom: { role: "zoom", title: "대표 음식 확대", prompt: "대표 음식의 식감이 보이도록 가까이서 찍어주세요." },
  card_food1: { role: "food1", title: "음식 사진 1", prompt: "다른 메뉴나 대표 음식의 다른 구도를 찍어주세요." },
  card_food2: { role: "food2", title: "음식 사진 2", prompt: "음식 사진을 한 장 더 찍어주세요." },
  card_store1: { role: "store1", title: "매장 외관", prompt: "간판과 입구가 함께 보이도록 찍어주세요." },
  card_store2: { role: "store2", title: "매장 내부", prompt: "좌석이나 진열이 보이도록 매장 내부를 찍어주세요." },
} as const;
export type CardNewsShot = keyof typeof CARDNEWS_SHOTS;
export const CARDNEWS_SHOT_PLAN = Object.keys(CARDNEWS_SHOTS) as CardNewsShot[];
export type CardNewsTheme = "minimal" | "christmas";

export function isCardNewsShot(value: unknown): value is CardNewsShot {
  return typeof value === "string" && Object.hasOwn(CARDNEWS_SHOTS, value);
}

export function isCardNewsEnabled() {
  return Boolean(process.env.CARDNEWS_API_URL?.trim());
}

export type CardNewsInput = {
  theme: CardNewsTheme;
  direction: string;
  storeName: string;
  area: string;
  menuName: string;
  caption: string;
  photos: Array<{ role: string; filePath: string }>;
};

export async function renderCardNews(
  client: SupabaseClient, input: CardNewsInput, ids: { storeId: string; submissionId: string; jobId: string },
) {
  const url = process.env.CARDNEWS_API_URL?.trim();
  const key = process.env.CARDNEWS_INTERNAL_API_KEY?.trim();
  if (!url || !key) throw new Error("Card news service is not configured");
  const base = new URL(url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid card news service URL");
  const bucket = getMediaStorage(client).from(getUploadStorageBucket());
  const roles = new Set<string>(Object.values(CARDNEWS_SHOTS).map(({ role }) => role));
  if (!Array.isArray(input.photos) || input.photos.length !== roles.size ||
      new Set(input.photos.map(photo => photo.filePath)).size !== roles.size) {
    throw new Error("Six different card news photos are required");
  }
  const photos = await Promise.all(input.photos.map(async ({ role, filePath }) => {
    if (!roles.delete(role) ||
        !filePath.startsWith(`stores/${ids.storeId}/food_photo/`)) throw new Error("Invalid card news photo");
    const { data, error } = await bucket.createSignedUrl(filePath, 15 * 60);
    if (error || !data?.signedUrl) throw new Error("Unable to sign a card news photo");
    return { role, download_url: data.signedUrl };
  }));
  const paths = [1, 2, 3].map(index => `${ids.storeId}/${ids.submissionId}/generated/${ids.jobId}-${index}.png`);
  const uploads = await Promise.all(paths.map(async path => {
    const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl) throw new Error("Unable to sign a card news output");
    return data.signedUrl;
  }));
  const response = await fetch(new URL("/cardnews/renders", base), {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(180_000),
    headers: { "Content-Type": "application/json", "x-cardnews-api-key": key },
    body: JSON.stringify({ job_id: ids.jobId, theme: input.theme, direction: input.direction,
      store_name: input.storeName, area: input.area, menu_name: input.menuName, photos, uploads }),
  });
  if (!response.ok) throw new Error(`Card news render failed (HTTP ${response.status})`);
  const result = await response.json() as { template: string; fallback: boolean; cards: Array<{ key: string; bytes: number }> };
  if (!Array.isArray(result.cards) || result.cards.length !== paths.length ||
      !result.cards.every((card, index) => card?.key === paths[index] &&
        Number.isSafeInteger(card.bytes) && card.bytes > 0 && card.bytes <= 10 * 1024 * 1024) ||
      typeof result.template !== "string" ||
      !(input.theme === "christmas" ? /^x[1-4]$/ : /^t[1-4]$/).test(result.template) ||
      typeof result.fallback !== "boolean") {
    throw new Error("Card news service returned invalid results");
  }
  return result;
}

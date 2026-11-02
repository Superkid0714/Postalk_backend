import { createHash } from "node:crypto";
import { isUuid } from "@/lib/validation";

export class ExhibitionError extends Error {
  constructor(message: string, public status = 400, public code = "VALIDATION_ERROR") { super(message); }
}
export type Menu = { id: string; name: string; description: string };
export type Scene = { sceneNumber: number; target: string; menuId: string | null; mediaType: "image" | "video"; durationSeconds: number };
export type Template = { id: string; version: string; usesSubtitles: boolean; maxSubtitleChars: number; scenes: Scene[]; renderer?: string };
export type CreationInput = {
  creationId: string; format: "card_news" | "reels"; conceptId: string; conceptDescription: string;
  storeDescription: string; menus: Menu[]; template: Template;
};

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExhibitionError("입력 내용을 다시 확인해 주세요.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== "string" || [...value.trim()].length > max || (required && !value.trim())) throw new ExhibitionError(`${label}을 확인해 주세요. 최대 ${max}자까지 입력할 수 있어요.`);
  return value.trim();
}
export function parseInfo(value: unknown) {
  const body = object(value);
  const storeDescription = text(body.storeDescription, "가게 설명", 3000);
  if (!Array.isArray(body.menus) || body.menus.length < 1 || body.menus.length > 3) throw new ExhibitionError("메뉴는 1개부터 3개까지 입력해 주세요.");
  const menus = body.menus.map(value => {
    const menu = object(value);
    return { id: text(menu.id, "메뉴 식별값", 64), name: text(menu.name, "메뉴 이름", 80), description: text(menu.description ?? "", "메뉴 설명", 500, false) };
  });
  if (new Set(menus.map(menu => menu.id)).size !== menus.length) throw new ExhibitionError("메뉴 식별값이 중복되었어요.");
  return { storeDescription, menus };
}
export function parseCreationInput(value: unknown): CreationInput {
  const body = object(value);
  if (!isUuid(body.creationId)) throw new ExhibitionError("제작 식별값을 확인해 주세요.");
  if (body.format !== "card_news" && body.format !== "reels") throw new ExhibitionError("카드뉴스 또는 릴스를 선택해 주세요.");
  const info = parseInfo(body);
  const template = object(body.template);
  if (typeof template.usesSubtitles !== "boolean") throw new ExhibitionError("템플릿의 자막 사용 여부를 확인해 주세요.");
  if (body.format === "card_news" && template.usesSubtitles) throw new ExhibitionError("카드뉴스에는 릴스 자막을 사용할 수 없어요.");
  const renderer = template.renderer ?? (body.format === "card_news" ? "source-photo-v1" : "scene-reel-v1");
  if (typeof renderer !== "string" || renderer !== (body.format === "card_news" ? "source-photo-v1" : "scene-reel-v1")) throw new ExhibitionError("이 템플릿의 결과물 디자인은 아직 연결되지 않았어요.", 409, "TEMPLATE_NOT_CONNECTED");
  const maxSubtitleChars = template.maxSubtitleChars ?? 40;
  if (!Number.isInteger(maxSubtitleChars) || (maxSubtitleChars as number) < 1 || (maxSubtitleChars as number) > 100) throw new ExhibitionError("장면별 자막 글자 수 제한을 확인해 주세요.");
  if (!Array.isArray(template.scenes) || !template.scenes.length || template.scenes.length > 20) throw new ExhibitionError("촬영 장면은 1개부터 20개까지 설정해 주세요.");
  const scenes = template.scenes.map((value, index): Scene => {
    const scene = object(value);
    if (scene.sceneNumber !== index + 1) throw new ExhibitionError("장면 번호는 1부터 순서대로 전달해 주세요.");
    if (scene.mediaType !== "image" && scene.mediaType !== "video") throw new ExhibitionError("장면의 사진·영상 형식을 확인해 주세요.");
    if (body.format === "card_news" && scene.mediaType !== "image") throw new ExhibitionError("카드뉴스 재료는 사진으로 전달해 주세요.");
    const menuId = scene.menuId == null ? null : text(scene.menuId, "메뉴 식별값", 64);
    if (menuId && !info.menus.some(menu => menu.id === menuId)) throw new ExhibitionError("장면에 연결된 메뉴를 찾지 못했어요.");
    const durationSeconds = scene.durationSeconds ?? 3;
    if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 15) throw new ExhibitionError("장면 길이는 1초부터 15초까지 설정해 주세요.");
    return { sceneNumber: index + 1, target: text(scene.target, "장면 대상", 100), menuId, mediaType: scene.mediaType, durationSeconds };
  });
  return { creationId: body.creationId, format: body.format, conceptId: text(body.conceptId, "콘셉트", 100), conceptDescription: text(body.conceptDescription ?? "", "콘셉트 설명", 2000, false), ...info,
    template: { id: text(template.id, "템플릿 식별값", 100), version: text(template.version, "템플릿 버전", 50), usesSubtitles: template.usesSubtitles, maxSubtitleChars: maxSubtitleChars as number, scenes, renderer } };
}

export function parseSubtitles(value: unknown, input: CreationInput) {
  if (!input.template.usesSubtitles) {
    if (value !== undefined && (!Array.isArray(value) || value.length)) throw new ExhibitionError("이 템플릿은 자막을 사용하지 않아요.");
    return [] as Array<{ sceneNumber: number; text: string }>;
  }
  if (!Array.isArray(value) || value.length !== input.template.scenes.length) throw new ExhibitionError("모든 장면의 자막을 확인해 주세요.");
  return value.map((value, index) => {
    const row = object(value);
    if (row.sceneNumber !== index + 1) throw new ExhibitionError("자막 순서가 장면 순서와 달라요.");
    return { sceneNumber: index + 1, text: text(row.text, "자막", input.template.maxSubtitleChars) };
  });
}

export function validateCaption(value: unknown) {
  const caption = text(value, "캡션", 2200, false);
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) throw new ExhibitionError("해시태그는 30개까지 입력할 수 있어요.");
  return caption;
}
export function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

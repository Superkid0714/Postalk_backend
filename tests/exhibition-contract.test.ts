import assert from "node:assert/strict";
import test from "node:test";
import { parseCreationInput, parseSubtitles, validateCaption, ExhibitionError } from "../lib/exhibition/contract.ts";
import { creationToken, exhibitionAccess, requireCreationToken } from "../lib/exhibition/access.ts";
import { responseText, ruleSubtitles } from "../lib/exhibition/scripts.ts";

const creationId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
export const sampleInput = () => ({ creationId, format: "reels", conceptId: "supplied-by-design-team", storeDescription: "시장 골목의 작은 가게예요.", menus: [{ id: "menu-1", name: "떡볶이", description: "매콤하게 준비해요." }],
  template: { id: "external-template", version: "1", usesSubtitles: true, maxSubtitleChars: 40, scenes: [{ sceneNumber: 1, target: "대표 메뉴", menuId: "menu-1", mediaType: "video", durationSeconds: 3 }] } });

test("concept and menu-dependent scene definitions are supplied rather than hardcoded", () => {
  const input = parseCreationInput(sampleInput());
  assert.equal(input.conceptId, "supplied-by-design-team");
  assert.equal(input.template.scenes.length, 1);
  for (const value of [null, { ...sampleInput(), menus: [] }, { ...sampleInput(), menus: Array.from({ length: 4 }, () => sampleInput().menus[0]) }]) assert.throws(() => parseCreationInput(value), ExhibitionError);
  const invalid = sampleInput(); invalid.template.scenes[0].menuId = "missing";
  assert.throws(() => parseCreationInput(invalid));
});
test("silent templates reject captions and captioned reels preserve exact edited subtitle text", () => {
  const input = parseCreationInput(sampleInput());
  const text = "직접 고친 자막이에요.";
  assert.deepEqual(parseSubtitles([{ sceneNumber: 1, text }], input), [{ sceneNumber: 1, text }]);
  assert.throws(() => parseSubtitles([], input));
  assert.throws(() => parseSubtitles([{ sceneNumber: 2, text }], input));
  assert.throws(() => parseSubtitles([{ sceneNumber: 1, text: "가".repeat(41) }], input));
  input.template.usesSubtitles = false;
  assert.deepEqual(parseSubtitles(undefined, input), []);
  assert.throws(() => parseSubtitles([{ sceneNumber: 1, text }], input));
});
test("captions use Unicode character count and bound hashtags", () => {
  assert.equal([...validateCaption("🍜".repeat(2200))].length, 2200);
  assert.throws(() => validateCaption("가".repeat(2201)));
  assert.throws(() => validateCaption(Array.from({ length: 31 }, (_, i) => `#메뉴${i}`).join(" ")));
});
test("exhibition user 1 is opt-in and creation permission is scoped to its in-memory creation", () => {
  const previous = { enabled: process.env.EXHIBITION_MODE_ENABLED, store: process.env.EXHIBITION_STORE_ID, secret: process.env.EXHIBITION_PUBLISH_SECRET };
  try {
    delete process.env.EXHIBITION_MODE_ENABLED;
    assert.throws(() => exhibitionAccess(new Request("http://localhost?user_id=1")), /찾을 수/);
    process.env.EXHIBITION_MODE_ENABLED = "true"; process.env.EXHIBITION_STORE_ID = storeId; process.env.EXHIBITION_PUBLISH_SECRET = "test-exhibition-secret-at-least-32-characters";
    assert.deepEqual(exhibitionAccess(new Request("http://localhost?user_id=1")), { userId: 1, storeId });
    assert.throws(() => exhibitionAccess(new Request("http://localhost?user_id=2")));
    assert.throws(() => exhibitionAccess(new Request("http://localhost?user_id=1"), { user_id: 2 }));
    const token = creationToken(creationId, storeId);
    assert.doesNotThrow(() => requireCreationToken(new Request("http://localhost", { headers: { "x-creation-token": token } }), creationId, storeId));
    assert.throws(() => requireCreationToken(new Request("http://localhost"), creationId, storeId));
    assert.throws(() => requireCreationToken(new Request("http://localhost", { headers: { "x-creation-token": token } }), "33333333-3333-4333-8333-333333333333", storeId));
  } finally {
    for (const [name, value] of [["EXHIBITION_MODE_ENABLED", previous.enabled], ["EXHIBITION_STORE_ID", previous.store], ["EXHIBITION_PUBLISH_SECRET", previous.secret]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  }
});
test("Responses text extraction supports raw API output blocks and scene-aligned fallback scripts", () => {
  assert.equal(responseText({ output: [{ content: [{ type: "output_text", text: "result" }] }] }), "result");
  assert.equal(ruleSubtitles(parseCreationInput(sampleInput()))[0].sceneNumber, 1);
});

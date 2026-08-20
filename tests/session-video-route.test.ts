import assert from "node:assert/strict";
import test from "node:test";

import { resolveDurationSeconds } from "../app/api/ad-sessions/[sessionId]/videos/route.ts";

test("resolveDurationSeconds accepts any positive durationSeconds value", () => {
  assert.equal(resolveDurationSeconds({ durationSeconds: 0.7 }), 0.7);
  assert.equal(resolveDurationSeconds({ durationSeconds: 2 }), 2);
  assert.equal(resolveDurationSeconds({ durationSeconds: 9.5 }), 9.5);
});

test("resolveDurationSeconds accepts durationMs when provided", () => {
  assert.equal(resolveDurationSeconds({ durationMs: 650 }), 0.65);
  assert.equal(resolveDurationSeconds({ durationMs: 4200 }), 4.2);
});

test("resolveDurationSeconds returns null for missing or non-positive values", () => {
  assert.equal(resolveDurationSeconds({}), null);
  assert.equal(resolveDurationSeconds({ durationSeconds: 0 }), null);
  assert.equal(resolveDurationSeconds({ durationSeconds: -1 }), null);
  assert.equal(resolveDurationSeconds({ durationMs: 0 }), null);
  assert.equal(resolveDurationSeconds({ durationMs: -100 }), null);
});

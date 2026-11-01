import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationArgs, sha256 } from "../scripts/migrate-media-to-s3.ts";

test("media migration defaults to a read-only inventory", () => {
  assert.equal(parseMigrationArgs([]).mode, "plan");
  for (const mode of ["copy", "promote", "rollback"]) {
    assert.throws(() => parseMigrationArgs(["--mode", mode]), /--apply/);
    assert.equal(parseMigrationArgs(["--mode", mode, "--apply"]).mode, mode);
  }
  assert.throws(() => parseMigrationArgs(["--mode", "delete"]));
  assert.throws(() => parseMigrationArgs(["--limit", "0"]));
  assert.equal(parseMigrationArgs(["--limit", "5"]).limit, 5);
});

test("media verification detects changed bytes", () => {
  assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(sha256(Buffer.from("abc")), sha256(Buffer.from("abd")));
});

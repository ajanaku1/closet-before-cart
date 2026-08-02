import assert from "node:assert/strict";
import test from "node:test";
import { shouldDeleteRawMedia } from "../../src/domain/media-retention.ts";

test("deletes raw photos after rendering or a failed job", () => {
  assert.equal(shouldDeleteRawMedia("RENDERED"), true);
  assert.equal(shouldDeleteRawMedia("FAILED"), true);
});

test("keeps raw photos only while extraction is incomplete", () => {
  assert.equal(shouldDeleteRawMedia("EXTRACTING"), false);
  assert.equal(shouldDeleteRawMedia("EXTRACTED"), false);
});

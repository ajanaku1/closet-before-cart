import assert from "node:assert/strict";
import test from "node:test";
import { canTransition } from "../../src/domain/state.ts";

test("allows the direct-photo extraction path", () => {
  assert.equal(canTransition("RECEIVED", "EXTRACTING"), true);
  assert.equal(canTransition("EXTRACTING", "WARDROBE_READY"), true);
  assert.equal(canTransition("WARDROBE_READY", "RENDERING"), true);
  assert.equal(canTransition("RENDERING", "GAP_FOUND"), true);
});

test("never allows STYLE_READY to enter payment", () => {
  assert.equal(canTransition("STYLE_READY", "QUOTING"), false);
  assert.equal(canTransition("STYLE_READY", "AWAITING_APPROVAL"), false);
});

test("requires approval before a successful payment state", () => {
  assert.equal(canTransition("GAP_FOUND", "QUOTING"), true);
  assert.equal(canTransition("QUOTING", "AWAITING_APPROVAL"), true);
  assert.equal(canTransition("AWAITING_APPROVAL", "PAYMENT_PROCESSING"), true);
  assert.equal(canTransition("PAYMENT_PROCESSING", "SANDBOX_COMPLETED"), true);
  assert.equal(canTransition("GAP_FOUND", "SANDBOX_COMPLETED"), false);
});

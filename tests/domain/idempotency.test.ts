import assert from "node:assert/strict";
import test from "node:test";
import { claimExternalEvent, formatSafeError } from "../../src/domain/guards.ts";

test("claims an external event once and treats retries as duplicates", () => {
  const claimed = new Set<string>();

  assert.equal(claimExternalEvent(claimed, "LINQ:event-1"), "NEW");
  assert.equal(claimExternalEvent(claimed, "LINQ:event-1"), "DUPLICATE");
  assert.equal(claimExternalEvent(claimed, "PRAVA:event-1"), "NEW");
});

test("formats provider failures without leaking response bodies", () => {
  assert.deepEqual(formatSafeError("QUOTE_UNAVAILABLE", "req-1"), {
    error: { code: "QUOTE_UNAVAILABLE", message: "The requested operation could not be completed.", requestId: "req-1" },
  });
});

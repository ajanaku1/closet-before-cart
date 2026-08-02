import assert from "node:assert/strict";
import test from "node:test";
import { canRequestPayment } from "../../src/domain/quote-gate.ts";

const proof = {
  proofId: "proof-1",
  caseId: "case-1",
  garmentDigest: "garments-1",
  constraintDigest: "constraints-1",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND" as const,
  missingCategory: "BOTTOM" as const,
  quoteId: "quote-1",
  issuedAt: "2026-08-01T12:00:00Z",
  expiresAt: "2026-08-01T12:15:00Z",
  signature: "signature",
};

const quote = {
  quoteId: "quote-1",
  merchant: "basics-clothing",
  variantId: "bottom-navy-32",
  amountMinor: 4999,
  currency: "USD",
  available: true,
  source: "PINNED_DEMO" as const,
  retrievedAt: "2026-08-01T12:01:00Z",
};

test("allows payment only for an available quote bound to a GAP_FOUND proof", () => {
  assert.equal(canRequestPayment(proof, quote), true);
});

test("rejects quote id, decision, availability, and amount mismatches", () => {
  assert.equal(canRequestPayment({ ...proof, quoteId: "quote-2" }, quote), false);
  assert.equal(canRequestPayment({ ...proof, decision: "STYLE_READY", quoteId: undefined }, quote), false);
  assert.equal(canRequestPayment(proof, { ...quote, available: false }), false);
  assert.equal(canRequestPayment(proof, { ...quote, amountMinor: 0 }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { issueStyleProof, verifyStyleProof } from "../../src/domain/proof.ts";

const input = {
  caseId: "case-1",
  garmentDigest: "garments-1",
  constraintDigest: "constraints-1",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND" as const,
  missingCategory: "TOP" as const,
  quoteId: "quote-1",
};

test("issues a proof that verifies against its signing secret", () => {
  const proof = issueStyleProof(input, "fixture-secret", "2026-08-01T12:00:00Z", 900);

  assert.equal(verifyStyleProof(proof, "fixture-secret", "2026-08-01T12:05:00Z"), true);
  assert.equal(verifyStyleProof(proof, "wrong-secret", "2026-08-01T12:05:00Z"), false);
});

test("rejects an expired or tampered proof", () => {
  const proof = issueStyleProof(input, "fixture-secret", "2026-08-01T12:00:00Z", 900);
  const tampered = { ...proof, quoteId: "quote-2" };

  assert.equal(verifyStyleProof(proof, "fixture-secret", "2026-08-01T12:16:00Z"), false);
  assert.equal(verifyStyleProof(tampered, "fixture-secret", "2026-08-01T12:05:00Z"), false);
});

test("fails closed for malformed timestamps", () => {
  const proof = issueStyleProof(input, "fixture-secret", "2026-08-01T12:00:00Z", 900);

  assert.equal(verifyStyleProof(proof, "fixture-secret", "not-a-date"), false);
  assert.equal(verifyStyleProof({ ...proof, expiresAt: "not-a-date" }, "fixture-secret", "2026-08-01T12:05:00Z"), false);
});

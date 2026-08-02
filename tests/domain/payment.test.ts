import assert from "node:assert/strict";
import test from "node:test";
import { bindQuoteToProof, requestApprovalForProof } from "../../src/domain/payment.ts";
import type { ProofCodec } from "../../src/contracts/adapters.ts";

const proof = {
  proofId: "proof-1",
  caseId: "case-1",
  garmentDigest: "garments-1",
  constraintDigest: "constraints-1",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND" as const,
  missingCategory: "SHOES" as const,
  quoteId: "quote-1",
  merchant: "basics-clothing",
  variantId: "shoe-derby",
  amountMinor: 4999,
  currency: "USD",
  issuedAt: "2026-08-01T12:00:00Z",
  expiresAt: "2026-08-01T12:15:00Z",
  signature: "signature",
};

const quote = {
  quoteId: "quote-1",
  merchant: "basics-clothing",
  variantId: "shoe-derby",
  amountMinor: 4999,
  currency: "USD",
  available: true,
  source: "PINNED_DEMO" as const,
  retrievedAt: "2026-08-01T12:01:00Z",
};

test("requests approval only after the proof verifier and quote gate pass", async () => {
  let called = 0;
  const result = await requestApprovalForProof(
    proof,
    quote,
    async () => true,
    async () => {
      called += 1;
      return { approvalId: "approval-1" };
    },
  );

  assert.deepEqual(result, { approvalId: "approval-1" });
  assert.equal(called, 1);
});

test("fails closed without calling Prava for an invalid proof or changed quote", async () => {
  let called = 0;
  const gateway = async (): Promise<{ approvalId: string }> => {
    called += 1;
    return { approvalId: "should-not-happen" };
  };

  await assert.rejects(
    requestApprovalForProof({ ...proof, decision: "STYLE_READY" }, quote, async () => true, gateway),
    /payment is not allowed/i,
  );
  await assert.rejects(
    requestApprovalForProof(proof, { ...quote, amountMinor: 5999 }, async () => true, gateway),
    /payment is not allowed/i,
  );
  await assert.rejects(
    requestApprovalForProof(proof, quote, async () => false, gateway),
    /proof is invalid/i,
  );

  assert.equal(called, 0);
});

test("issues a fresh quote-bound proof instead of mutating the prior proof", async () => {
  const codec: ProofCodec = {
    async issue(payload) {
      return { ...payload, proofId: "proof-2", signature: "new-signature" };
    },
    async verify() {
      return null;
    },
  };

  const bound = await bindQuoteToProof(
    proof,
    quote,
    codec,
    "2026-08-01T12:02:00Z",
    900,
  );

  assert.equal(bound.proofId, "proof-2");
  assert.equal(bound.quoteId, quote.quoteId);
  assert.equal(bound.merchant, quote.merchant);
  assert.equal(bound.variantId, quote.variantId);
  assert.equal(bound.amountMinor, quote.amountMinor);
  assert.equal(bound.currency, quote.currency);
  assert.equal(proof.proofId, "proof-1");
});

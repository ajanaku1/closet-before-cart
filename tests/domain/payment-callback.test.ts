import assert from "node:assert/strict";
import test from "node:test";
import { handlePravaCallback, type PravaCallback } from "../../src/domain/payment-callback.ts";

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

function approvedCallback(overrides: Partial<PravaCallback> = {}): PravaCallback {
  return {
    eventId: "result-1",
    approvalId: "approval-1",
    proofId: "proof-1",
    quoteId: "quote-1",
    merchant: "basics-clothing",
    amountMinor: 4999,
    currency: "USD",
    mode: "SANDBOX",
    status: "APPROVED",
    ...overrides,
  };
}

test("turns a matching sandbox approval into a labelled sandbox receipt", async () => {
  const claimed: string[] = [];
  const result = await handlePravaCallback(
    approvedCallback(),
    proof,
    quote,
    async (eventId) => {
      claimed.push(eventId);
      return true;
    },
  );

  assert.deepEqual(result, {
    kind: "SANDBOX_COMPLETED",
    receiptLabel: "SANDBOX_RECEIPT_NOT_MERCHANT_ORDER",
  });
  assert.deepEqual(claimed, ["result-1"]);
});

test("returns the recorded duplicate outcome without reprocessing", async () => {
  const result = await handlePravaCallback(
    approvedCallback(),
    proof,
    quote,
    async () => false,
  );

  assert.deepEqual(result, { kind: "DUPLICATE" });
});

test("rejects changed quote bounds and production approval without an order result", async () => {
  const claim = async (): Promise<boolean> => true;

  const changed = await handlePravaCallback(
    approvedCallback({ amountMinor: 5999 }),
    proof,
    quote,
    claim,
  );
  assert.deepEqual(changed, { kind: "FAILED", reason: "QUOTE_BOUNDS_MISMATCH" });

  const production = await handlePravaCallback(
    approvedCallback({ mode: "PRODUCTION" }),
    proof,
    quote,
    claim,
  );
  assert.deepEqual(production, { kind: "FAILED", reason: "ORDER_RESULT_REQUIRED" });
});

test("rejects a callback when the matching quote is no longer purchasable", async () => {
  for (const notPurchasable of [
    { ...quote, available: false },
    { ...quote, amountMinor: 0 },
  ]) {
    const result = await handlePravaCallback(
      approvedCallback(),
      proof,
      notPurchasable,
      async () => true,
    );

    assert.deepEqual(result, { kind: "FAILED", reason: "QUOTE_BOUNDS_MISMATCH" });
  }
});

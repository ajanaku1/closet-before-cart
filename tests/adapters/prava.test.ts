import assert from "node:assert/strict";
import test from "node:test";
import { createPravaGateway } from "../../src/adapters/prava.ts";
import type { CommerceQuote, StyleProof } from "../../src/contracts/domain.ts";

const quote: CommerceQuote = {
  quoteId: "55555555-5555-4555-8555-555555555555",
  merchant: "Demo Wardrobe",
  variantId: "formal-shoes-42",
  amountMinor: 2900,
  currency: "USD",
  available: true,
  source: "PINNED_DEMO",
  retrievedAt: "2026-08-02T12:00:00Z",
};
const proof = {
  proofId: "44444444-4444-4444-8444-444444444444",
  caseId: "33333333-3333-4333-8333-333333333333",
  garmentDigest: "garments",
  constraintDigest: "constraints",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND",
  missingCategory: "SHOES",
  quoteId: quote.quoteId,
  merchant: quote.merchant,
  variantId: quote.variantId,
  amountMinor: quote.amountMinor,
  currency: quote.currency,
  issuedAt: "2026-08-02T12:00:00Z",
  expiresAt: "2026-08-02T12:15:00Z",
  signature: "signature",
} satisfies StyleProof;

test("creates a Prava sandbox hosted session bounded to the proof quote", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "shopper@example.com",
    callbackUrl: "https://cbc.example/api/prava/return",
    merchantUrl: "https://demo.example.com",
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ session_id: "sess-1", iframe_url: "https://sandbox.collect.prava.space/s/1" }, { status: 201 });
    },
  });

  const result = await gateway.requestApproval(proof, quote, "synthetic-sender-1");
  const body = JSON.parse(String(requests[0]?.init?.body));

  assert.equal(requests[0]?.url, "https://sandbox.api.prava.space/v1/sessions");
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer sk_test_fixture");
  assert.equal(body.total_amount, "29.00");
  assert.equal(body.currency, "USD");
  assert.equal(body.external_order_ref, proof.proofId);
  assert.match(body.user_id, /^cbc_[a-f0-9]{64}$/);
  assert.notEqual(body.user_id, proof.caseId);
  assert.notEqual(body.user_id, "synthetic-sender-1");
  assert.equal(body.purchase_context[0].product_details[0].product_id, quote.variantId);
  assert.deepEqual(result, { approvalId: "sess-1", approvalUrl: "https://sandbox.collect.prava.space/s/1" });
});

test("rejects non-test Prava keys in sandbox mode", () => {
  assert.throws(() => createPravaGateway({
    secretKey: "sk_live_fixture",
    userEmail: "shopper@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://demo.example.com",
  }), /test key/i);
});

test("rejects non-routable customer email domains before creating a session", () => {
  for (const userEmail of [
    "owner@merchant.local",
    "owner@merchant.test",
    "owner@merchant.example",
    "owner@merchant.invalid",
    "owner@merchant.internal",
  ]) {
    assert.throws(() => createPravaGateway({
      secretKey: "sk_test_fixture",
      userEmail,
      callbackUrl: "https://cbc.example/return",
      merchantUrl: "https://example.com",
    }), /customer email/i);
  }
});

test("rejects merchant URLs that are not a bare HTTPS origin on an allowed TLD", () => {
  for (const merchantUrl of [
    "http://example.com",
    "https://example.com/products/shoes",
    "https://merchant.demo",
    "www.example.com",
  ]) {
    assert.throws(() => createPravaGateway({
      secretKey: "sk_test_fixture",
      userEmail: "demo@example.com",
      callbackUrl: "https://cbc.example/return",
      merchantUrl,
    }), /merchant url/i);
  }
});

test("refuses a quote that is not cryptographically bound into the proof", async () => {
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "shopper@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://demo.example.com",
    fetch: async () => { throw new Error("must not call Prava"); },
  });

  await assert.rejects(
    gateway.requestApproval({ ...proof, amountMinor: 5000 }, quote, "sender-test"),
    /bound quote/i,
  );
});

test("uses one stable Prava customer id across separate cases from the same sender", async () => {
  const userIds: string[] = [];
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "shopper@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://demo.example.com",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      userIds.push(body.user_id);
      return Response.json({ session_id: `sess-${userIds.length}`, iframe_url: "https://sandbox.collect.prava.space/s/1" }, { status: 201 });
    },
  });

  await gateway.requestApproval(proof, quote, "sender-test");
  await gateway.requestApproval(
    { ...proof, caseId: "99999999-9999-4999-8999-999999999999" },
    quote,
    "sender-test",
  );

  assert.equal(userIds[0], userIds[1]);
});

test("maps Prava payment-result states without exposing payment credentials", async () => {
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "shopper@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://demo.example.com",
    fetch: async () => Response.json({
      status: "awaiting_result",
      transactions: [{ line_items: [{ token: "sensitive", dynamic_cvv: "999" }] }],
    }),
  });

  assert.deepEqual(await gateway.getResult("sess-1"), { status: "APPROVED" });
});

test("preserves safe Prava error code and message from failed HTTP calls", async () => {
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "demo@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://example.com",
    fetch: async () => Response.json({
      error: {
        code: "PASSKEY_REG_FAILED",
        message: "Passkey registration failed for this customer email",
      },
    }, { status: 400 }),
  });

  await assert.rejects(
    gateway.requestApproval(proof, quote, "sender-test"),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: unknown }).code, "PASSKEY_REG_FAILED");
      assert.match((error as { message?: string }).message ?? "", /Passkey registration failed/);
      return true;
    },
  );
});

test("returns the specific terminal failure without exposing credentials", async () => {
  const gateway = createPravaGateway({
    secretKey: "sk_test_fixture",
    userEmail: "demo@example.com",
    callbackUrl: "https://cbc.example/return",
    merchantUrl: "https://example.com",
    fetch: async () => Response.json({
      status: "failed",
      error: { code: "PASSKEY_REG_FAILED", message: "Passkey registration failed" },
      transactions: [{ line_items: [{ token: "sensitive", dynamic_cvv: "999" }] }],
    }),
  });

  assert.deepEqual(await gateway.getResult("sess-1"), {
    status: "DECLINED",
    error: { code: "PASSKEY_REG_FAILED", message: "Passkey registration failed" },
  });
});

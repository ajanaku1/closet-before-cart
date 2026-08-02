import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the reliable pinned demo quote for Prava payment retries", async () => {
  const runtime = await import("../../src/workflow/runtime.ts");
  const source = await readFile(new URL("../../src/workflow/runtime.ts", import.meta.url), "utf8");

  assert.deepEqual((runtime as Record<string, unknown>).demoQuote, {
    quoteId: "pinned-quote-v1",
    merchant: "Pinned apparel demo",
    variantId: "shoes-demo-v1",
    amountMinor: 2_900,
    currency: "USD",
    available: true,
    source: "PINNED_DEMO",
    retrievedAt: "2026-08-02T00:00:00.000Z",
  });
  assert.match(source, /new PinnedCommerceAdapter\(createDemoQuote\(\)\)/);
  assert.doesNotMatch(source, /createEverlaneCommerceAdapter/);
  assert.match(source, /merchantUrl: appUrl/);
  assert.match(
    source,
    /errorMessage: "Checkout or sandbox approval could not be initialized safely"/,
  );
  assert.match(source, /processShoppingReply/);
  assert.match(source, /runWithTyping\(event\.chatId/);
});

test("gives every pinned payment retry a fresh quote identity", async () => {
  const { createDemoQuote } = await import("../../src/workflow/runtime.ts");

  const first = createDemoQuote();
  const second = createDemoQuote();

  assert.notEqual(first.quoteId, second.quoteId);
  assert.equal(first.amountMinor, 2_900);
  assert.equal(first.source, "PINNED_DEMO");
});

test("wraps Prava's one-time URL in CBC's preview-safe launch page", async () => {
  const { approvalLaunchUrl } = await import("../../src/workflow/runtime.ts");

  const url = approvalLaunchUrl(
    "https://closet-before-cart.vercel.app",
    "https://sandbox.collect.prava.space/s/session-1",
  );

  assert.equal(
    url,
    "https://closet-before-cart.vercel.app/api/approval-launch?target=https%3A%2F%2Fsandbox.collect.prava.space%2Fs%2Fsession-1",
  );
  assert.throws(
    () => approvalLaunchUrl("https://closet-before-cart.vercel.app", "https://example.com/s/session-1"),
    /Prava approval URL/i,
  );
  assert.match(
    approvalLaunchUrl(
      "https://closet-before-cart.vercel.app",
      "https://sandbox.collect.prava.space/checkout/session-2",
    ),
    /approval-launch/,
  );
});

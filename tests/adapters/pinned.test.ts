import assert from "node:assert/strict";
import test from "node:test";
import { PinnedCommerceAdapter } from "../../src/adapters/pinned.ts";

test("returns an explicit pinned apparel quote and demo handoff", async () => {
  const adapter = new PinnedCommerceAdapter({
    quoteId: "quote-1",
    merchant: "basics-clothing",
    variantId: "shoe-derby",
    amountMinor: 4999,
    currency: "USD",
    available: true,
    source: "PINNED_DEMO",
    retrievedAt: "2026-08-01T12:01:00Z",
  });

  const quote = await adapter.findGapItem("SHOES", {
    occasion: "wedding",
    requiredCategories: ["TOP", "BOTTOM", "SHOES"],
    excludedColors: ["BLACK"],
    maxNewItems: 1,
    referencePhotoPresent: true,
  });
  const cart = await adapter.createCart(quote);
  const handoff = await adapter.getCheckoutHandoff(cart.cartId);

  assert.equal(quote.source, "PINNED_DEMO");
  assert.match(cart.cartId, /^pinned-cart-/);
  assert.match(handoff.checkoutUrl, /^https:\/\/demo\.invalid\//);
});

test("does not reconcile a quote whose immutable bounds changed", async () => {
  const adapter = new PinnedCommerceAdapter({
    quoteId: "quote-1",
    merchant: "basics-clothing",
    variantId: "shoe-derby",
    amountMinor: 4999,
    currency: "USD",
    available: true,
    source: "PINNED_DEMO",
    retrievedAt: "2026-08-01T12:01:00Z",
  });

  await assert.rejects(
    adapter.reconcileQuote({
      quoteId: "quote-1",
      merchant: "basics-clothing",
      variantId: "shoe-derby",
      amountMinor: 5999,
      currency: "USD",
      available: true,
      source: "PINNED_DEMO",
      retrievedAt: "2026-08-01T12:02:00Z",
    }),
    /immutable quote/i,
  );
});

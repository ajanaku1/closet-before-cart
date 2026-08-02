import assert from "node:assert/strict";
import test from "node:test";
import { createEverlaneCommerceAdapter } from "../../src/adapters/everlane.ts";

function product(
  title: string,
  tags: readonly string[],
  variant: { id: string; size: string; amount: number; available?: boolean },
) {
  return {
    title,
    tags,
    variants: [{
      id: variant.id,
      title: variant.size,
      price: { amount: variant.amount, currency: "USD" },
      availability: { available: variant.available ?? true },
      options: [{ name: "Size", label: variant.size }],
      checkout_url: `https://m34kzg-ke.myshopify.com/cart/${variant.id.split("/").at(-1)}:1`,
    }],
  };
}

function catalogResponse(products: readonly unknown[]): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { structuredContent: { products, messages: [] } },
  });
}

const constraints = {
  occasion: "Friday wedding",
  requiredCategories: ["TOP", "BOTTOM", "SHOES"] as const,
  excludedColors: ["BLACK"],
  maxNewItems: 1,
  referencePhotoPresent: true,
  minimumFormality: "SMART" as const,
  shoppingDepartment: "MEN" as const,
  shoppingSize: "10",
  maxPriceMinor: 20_000,
};

test("selects an exact available Everlane variant within the approved bounds", async () => {
  const requests: RequestInit[] = [];
  const adapter = createEverlaneCommerceAdapter({
    agentProfileUrl: "https://cbc.example/.well-known/ucp",
    now: () => "2026-08-02T20:00:00Z",
    quoteId: () => "55555555-5555-4555-8555-555555555555",
    fetch: async (_url, init) => {
      requests.push(init ?? {});
      return catalogResponse([
        product("Italian Loafer | Black", ["male", "Black"], {
          id: "gid://shopify/ProductVariant/1", size: "10", amount: 15_000,
        }),
        product("Italian Loafer | Mocha", ["male", "Brown"], {
          id: "gid://shopify/ProductVariant/2", size: "10", amount: 18_000,
        }),
        product("Italian Loafer | Mocha", ["female", "Brown"], {
          id: "gid://shopify/ProductVariant/3", size: "10", amount: 17_000,
        }),
      ]);
    },
  });

  const quote = await adapter.findGapItem("SHOES", constraints);
  const body = JSON.parse(String(requests[0]?.body));

  assert.equal(body.params.name, "search_catalog");
  assert.equal(
    body.params.arguments.meta["ucp-agent"].profile,
    "https://cbc.example/.well-known/ucp",
  );
  assert.match(body.params.arguments.catalog.query, /men/i);
  assert.equal(body.params.arguments.catalog.context.address_country, "US");
  assert.deepEqual(quote, {
    quoteId: "55555555-5555-4555-8555-555555555555",
    merchant: "Everlane",
    variantId: "gid://shopify/ProductVariant/2",
    size: "10",
    color: "Mocha",
    amountMinor: 18_000,
    currency: "USD",
    available: true,
    source: "LIVE",
    retrievedAt: "2026-08-02T20:00:00Z",
    checkoutUrl: "https://m34kzg-ke.myshopify.com/cart/2:1",
  });
});

test("fails closed when Everlane has no exact variant within budget", async () => {
  const adapter = createEverlaneCommerceAdapter({
    agentProfileUrl: "https://cbc.example/.well-known/ucp",
    fetch: async () => catalogResponse([
      product("Italian Loafer | Mocha", ["male", "Brown"], {
        id: "gid://shopify/ProductVariant/2", size: "10", amount: 32_800,
      }),
    ]),
  });

  await assert.rejects(
    adapter.findGapItem("SHOES", constraints),
    (error: unknown) => error instanceof Error
      && error.name === "CommerceLookupError"
      && (error as Error & { readonly code?: string }).code === "NO_EXACT_OPTION",
  );
});

test("accepts current UCP variants without checkout_url and reads department from SKU", async () => {
  const adapter = createEverlaneCommerceAdapter({
    agentProfileUrl: "https://cbc.example/.well-known/ucp",
    now: () => "2026-08-02T20:00:00Z",
    quoteId: () => "55555555-5555-4555-8555-555555555555",
    fetch: async () => catalogResponse([{
      title: "Italian Loafer | Mocha",
      tags: ["Style SKU: M-FTWR-LTHR-LFR", "Brown"],
      variants: [{
        id: "gid://shopify/ProductVariant/2",
        price: { amount: 18_000, currency: "USD" },
        availability: { available: true },
        options: [{ name: "Size", label: "10" }],
      }],
    }]),
  });

  const quote = await adapter.findGapItem("SHOES", constraints);

  assert.equal(quote.variantId, "gid://shopify/ProductVariant/2");
  assert.equal(quote.checkoutUrl, undefined);
});

test("requires the shopping questions to be complete before network access", async () => {
  let requests = 0;
  const adapter = createEverlaneCommerceAdapter({
    agentProfileUrl: "https://cbc.example/.well-known/ucp",
    fetch: async () => { requests += 1; return catalogResponse([]); },
  });

  await assert.rejects(
    adapter.findGapItem("SHOES", { ...constraints, shoppingSize: undefined } as never),
    /shopping details/i,
  );
  assert.equal(requests, 0);
});

test("rejects malformed Everlane responses instead of inventing a quote", async () => {
  const adapter = createEverlaneCommerceAdapter({
    agentProfileUrl: "https://cbc.example/.well-known/ucp",
    fetch: async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
  });

  await assert.rejects(adapter.findGapItem("SHOES", constraints), /catalog response/i);
});

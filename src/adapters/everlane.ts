import { randomUUID } from "node:crypto";
import type { CommerceAdapter } from "../contracts/adapters.js";
import type { CommerceQuote } from "../contracts/domain.js";
import type { StyleConstraints } from "../domain/style-gap.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

export interface EverlaneCommerceOptions {
  readonly agentProfileUrl: string;
  readonly fetch?: Fetcher;
  readonly now?: () => string;
  readonly quoteId?: () => string;
}

interface EverlaneContext {
  readonly profile: string;
  readonly fetcher: Fetcher;
  readonly now: () => string;
  readonly quoteId: () => string;
}

interface Variant {
  readonly id: string;
  readonly size: string;
  readonly amount: number;
  readonly currency: string;
  readonly checkoutUrl?: string;
}

interface Product {
  readonly title: string;
  readonly tags: readonly string[];
  readonly variants: readonly Variant[];
}

const endpoint = "https://m34kzg-ke.myshopify.com/api/ucp/mcp";
const checkoutHosts = new Set(["m34kzg-ke.myshopify.com", "www.everlane.com", "everlane.com"]);

export class CommerceLookupError extends Error {
  constructor(
    readonly code: "NO_EXACT_OPTION",
    message: string,
  ) {
    super(message);
    this.name = "CommerceLookupError";
  }
}

function object(value: unknown, context: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Everlane ${context} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, context: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`Everlane ${context} is invalid`);
  return value;
}

function checkoutUrl(value: unknown): string {
  const raw = string(value, "checkout URL");
  const url = new URL(raw);
  if (url.protocol !== "https:" || !checkoutHosts.has(url.hostname) || !url.pathname.startsWith("/cart/")) {
    throw new Error("Everlane checkout URL is invalid");
  }
  return url.href;
}

function parseVariant(value: unknown): Variant | undefined {
  const row = object(value, "variant");
  const availability = object(row.availability, "variant availability");
  if (availability.available !== true) return undefined;
  const price = object(row.price, "variant price");
  const options = Array.isArray(row.options) ? row.options : [];
  const sizeOption = options.map((option) => object(option, "variant option"))
    .find((option) => option.name === "Size");
  const checkout = row.checkout_url === undefined
    ? {}
    : { checkoutUrl: checkoutUrl(row.checkout_url) };
  return {
    id: string(row.id, "variant id"),
    size: string(sizeOption?.label, "variant size"),
    amount: Number(price.amount),
    currency: string(price.currency, "variant currency"),
    ...checkout,
  };
}

function parseProduct(value: unknown): Product {
  const row = object(value, "product");
  if (!Array.isArray(row.tags) || !Array.isArray(row.variants)) {
    throw new Error("Everlane catalog product is invalid");
  }
  return {
    title: string(row.title, "product title"),
    tags: row.tags.map((tag) => string(tag, "product tag")),
    variants: row.variants.map(parseVariant).filter((item): item is Variant => item !== undefined),
  };
}

function products(value: unknown): readonly Product[] {
  const root = object(value, "catalog response");
  const result = object(root.result, "catalog result");
  const content = object(result.structuredContent, "catalog response content");
  if (!Array.isArray(content.products)) throw new Error("Everlane catalog response has no products");
  return content.products.map(parseProduct);
}

function requestBody(category: string, constraints: StyleConstraints, profile: string): string {
  const department = constraints.shoppingDepartment?.toLowerCase();
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    id: 1,
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile } },
        catalog: {
          query: `${department} ${constraints.minimumFormality ?? "smart"} ${category.toLowerCase()} for ${constraints.occasion}`,
          context: {
            address_country: "US",
            language: "en-US",
            currency: "USD",
            intent: `${constraints.occasion}; exclude ${constraints.excludedColors.join(", ") || "no colors"}`,
          },
          pagination: { limit: 50 },
        },
      },
    },
  });
}

function matchesProduct(product: Product, constraints: StyleConstraints): boolean {
  const labels = [product.title, ...product.tags].map((value) => value.toUpperCase());
  const gender = constraints.shoppingDepartment === "MEN" ? "MALE" : "FEMALE";
  const skuPrefix = constraints.shoppingDepartment === "MEN" ? "STYLE SKU: M-" : "STYLE SKU: F-";
  return (labels.includes(gender) || labels.some((label) => label.startsWith(skuPrefix)))
    && !constraints.excludedColors.some((color) => labels.some((label) => label.includes(color)));
}

function matchingVariant(products: readonly Product[], constraints: StyleConstraints) {
  for (const product of products) {
    if (!matchesProduct(product, constraints)) continue;
    const variant = product.variants.find((item) =>
      item.size === constraints.shoppingSize
      && item.currency === "USD"
      && Number.isSafeInteger(item.amount)
      && item.amount > 0
      && item.amount <= (constraints.maxPriceMinor ?? 0));
    if (variant !== undefined) return { product, variant };
  }
  return undefined;
}

function completeDetails(constraints: StyleConstraints): boolean {
  return constraints.shoppingDepartment !== undefined
    && constraints.shoppingSize !== undefined
    && constraints.maxPriceMinor !== undefined;
}

function quote(match: { product: Product; variant: Variant }, context: EverlaneContext): CommerceQuote {
  const color = match.product.title.split("|").at(-1)?.trim();
  return {
    quoteId: context.quoteId(),
    merchant: "Everlane",
    variantId: match.variant.id,
    size: match.variant.size,
    ...(color ? { color } : {}),
    amountMinor: match.variant.amount,
    currency: match.variant.currency,
    available: true,
    source: "LIVE",
    retrievedAt: context.now(),
    ...(match.variant.checkoutUrl === undefined ? {} : { checkoutUrl: match.variant.checkoutUrl }),
  };
}

class EverlaneCommerceAdapter implements CommerceAdapter {
  private readonly carts = new Map<string, string>();

  constructor(private readonly context: EverlaneContext) {}

  async findGapItem(category: string, constraints: StyleConstraints): Promise<CommerceQuote> {
    if (!completeDetails(constraints)) throw new Error("Everlane shopping details are incomplete");
    const response = await this.context.fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: requestBody(category, constraints, this.context.profile),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Everlane catalog request failed (${response.status})`);
    const match = matchingVariant(products(await response.json()), constraints);
    if (match === undefined) {
      throw new CommerceLookupError(
        "NO_EXACT_OPTION",
        "No exact available option matched the department, US size, color rules, and maximum budget",
      );
    }
    return quote(match, this.context);
  }

  async createCart(value: CommerceQuote): Promise<{ cartId: string }> {
    if (value.source !== "LIVE" || !value.checkoutUrl) throw new Error("Everlane quote is not cart-ready");
    this.carts.set(value.quoteId, value.checkoutUrl);
    return { cartId: value.quoteId };
  }

  async getCheckoutHandoff(cartId: string): Promise<{ checkoutUrl: string }> {
    const url = this.carts.get(cartId);
    if (!url) throw new Error("Everlane cart is unknown");
    return { checkoutUrl: url };
  }

  async reconcileQuote(value: CommerceQuote): Promise<CommerceQuote> {
    if (value.source !== "LIVE" || value.merchant !== "Everlane") {
      throw new Error("Everlane quote cannot be reconciled");
    }
    return value;
  }
}

export function createEverlaneCommerceAdapter(options: EverlaneCommerceOptions): CommerceAdapter {
  const profile = new URL(options.agentProfileUrl);
  if (profile.protocol !== "https:") throw new Error("Everlane agent profile must use HTTPS");
  return new EverlaneCommerceAdapter({
    profile: profile.href,
    fetcher: options.fetch ?? fetch,
    now: options.now ?? (() => new Date().toISOString()),
    quoteId: options.quoteId ?? randomUUID,
  });
}

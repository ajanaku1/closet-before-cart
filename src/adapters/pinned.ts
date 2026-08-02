import type { CommerceAdapter } from "../contracts/adapters.js";
import type { CommerceQuote } from "../contracts/domain.js";
import type { StyleConstraints } from "../domain/style-gap.js";

function sameBounds(left: CommerceQuote, right: CommerceQuote): boolean {
  return left.quoteId === right.quoteId
    && left.merchant === right.merchant
    && left.variantId === right.variantId
    && left.amountMinor === right.amountMinor
    && left.currency === right.currency
    && left.source === right.source;
}

export class PinnedCommerceAdapter implements CommerceAdapter {
  private readonly quote: CommerceQuote;

  constructor(quote: CommerceQuote) {
    this.quote = quote;
    if (quote.source !== "PINNED_DEMO") throw new Error("Pinned adapter requires a PINNED_DEMO quote");
  }

  async findGapItem(category: string, constraints: StyleConstraints): Promise<CommerceQuote> {
    if (!category.trim() || constraints.maxNewItems < 1) throw new Error("Pinned quote is not allowed");
    if (!this.quote.available) throw new Error("Pinned quote is unavailable");
    return this.quote;
  }

  async createCart(quote: CommerceQuote): Promise<{ cartId: string }> {
    if (!sameBounds(quote, this.quote)) throw new Error("Pinned quote does not match cart bounds");
    return { cartId: `pinned-cart-${quote.quoteId}` };
  }

  async getCheckoutHandoff(cartId: string): Promise<{ checkoutUrl: string }> {
    if (!cartId.startsWith("pinned-cart-")) throw new Error("Pinned cart is unknown");
    return { checkoutUrl: `https://demo.invalid/checkout/${encodeURIComponent(cartId)}` };
  }

  async reconcileQuote(quote: CommerceQuote): Promise<CommerceQuote> {
    if (!sameBounds(quote, this.quote)) throw new Error("Immutable quote bounds changed");
    return this.quote;
  }
}

import type { CommerceQuote, StyleProof } from "../contracts/domain.js";

function hasPositiveAmount(quote: CommerceQuote): boolean {
  return Number.isFinite(quote.amountMinor) && quote.amountMinor > 0;
}

function hasRequiredQuoteFields(quote: CommerceQuote): boolean {
  return Boolean(quote.quoteId && quote.merchant && quote.variantId && quote.currency);
}

export function canRequestPayment(proof: StyleProof, quote: CommerceQuote): boolean {
  return proof.decision === "GAP_FOUND"
    && proof.quoteId === quote.quoteId
    && quote.available
    && hasPositiveAmount(quote)
    && hasRequiredQuoteFields(quote);
}

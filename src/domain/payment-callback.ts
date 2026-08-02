import type { CommerceQuote, StyleProof } from "../contracts/domain.js";

export interface PravaCallback {
  readonly eventId: string;
  readonly approvalId: string;
  readonly proofId: string;
  readonly quoteId: string;
  readonly merchant: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly status: "APPROVED" | "DECLINED" | "PENDING";
  readonly orderId?: string;
}

export type PravaCallbackResult =
  | { readonly kind: "DUPLICATE" }
  | { readonly kind: "PENDING" }
  | { readonly kind: "DECLINED" }
  | { readonly kind: "FAILED"; readonly reason: "QUOTE_BOUNDS_MISMATCH" | "ORDER_RESULT_REQUIRED" }
  | { readonly kind: "SANDBOX_COMPLETED"; readonly receiptLabel: "SANDBOX_RECEIPT_NOT_MERCHANT_ORDER" }
  | { readonly kind: "ORDER_COMPLETED"; readonly orderId: string };

type ClaimEvent = (eventId: string) => Promise<boolean>;

function matchesBoundQuote(callback: PravaCallback, proof: StyleProof, quote: CommerceQuote): boolean {
  return isPurchasableQuote(quote)
    && callback.proofId === proof.proofId
    && callback.quoteId === quote.quoteId
    && proof.quoteId === quote.quoteId
    && callback.merchant === quote.merchant
    && callback.amountMinor === quote.amountMinor
    && callback.currency === quote.currency
    && proof.merchant === quote.merchant
    && proof.variantId === quote.variantId
    && proof.amountMinor === quote.amountMinor
    && proof.currency === quote.currency;
}

function isPurchasableQuote(quote: CommerceQuote): boolean {
  return quote.available && Number.isFinite(quote.amountMinor) && quote.amountMinor > 0;
}

export async function handlePravaCallback(
  callback: PravaCallback,
  proof: StyleProof,
  quote: CommerceQuote,
  claimEvent: ClaimEvent,
): Promise<PravaCallbackResult> {
  if (!(await claimEvent(callback.eventId))) return { kind: "DUPLICATE" };
  if (!matchesBoundQuote(callback, proof, quote)) {
    return { kind: "FAILED", reason: "QUOTE_BOUNDS_MISMATCH" };
  }
  if (callback.status === "PENDING") return { kind: "PENDING" };
  if (callback.status === "DECLINED") return { kind: "DECLINED" };
  if (callback.mode === "SANDBOX") {
    return { kind: "SANDBOX_COMPLETED", receiptLabel: "SANDBOX_RECEIPT_NOT_MERCHANT_ORDER" };
  }
  if (!callback.orderId) return { kind: "FAILED", reason: "ORDER_RESULT_REQUIRED" };
  return { kind: "ORDER_COMPLETED", orderId: callback.orderId };
}

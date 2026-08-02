import type { CommerceQuote, StyleProof } from "../contracts/domain.js";
import type { ProofCodec } from "../contracts/adapters.js";
import { canRequestPayment } from "./quote-gate.js";

export type ProofVerifier = (proof: StyleProof) => Promise<boolean>;
export type ApprovalRequester = (
  proof: StyleProof,
  quote: CommerceQuote,
) => Promise<{ approvalId: string }>;

function proofMatchesQuote(proof: StyleProof, quote: CommerceQuote): boolean {
  return proof.merchant === quote.merchant
    && proof.variantId === quote.variantId
    && proof.amountMinor === quote.amountMinor
    && proof.currency === quote.currency;
}

function quoteExpiry(issuedAt: string, ttlSeconds: number): string {
  const timestamp = Date.parse(issuedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("proof timestamp or TTL is invalid");
  }
  return new Date(timestamp + ttlSeconds * 1000).toISOString();
}

export async function bindQuoteToProof(
  proof: StyleProof,
  quote: CommerceQuote,
  proofCodec: ProofCodec,
  issuedAt: string,
  ttlSeconds: number,
): Promise<StyleProof> {
  if (proof.decision !== "GAP_FOUND" || !quote.available || quote.amountMinor <= 0) {
    throw new Error("Quote cannot be bound to this proof");
  }
  if (proof.quoteId !== undefined && proof.quoteId !== quote.quoteId) {
    throw new Error("Quote cannot be changed on this proof");
  }
  const base = {
    caseId: proof.caseId,
    garmentDigest: proof.garmentDigest,
    constraintDigest: proof.constraintDigest,
    ruleVersion: proof.ruleVersion,
    decision: proof.decision,
    quoteId: quote.quoteId,
    merchant: quote.merchant,
    variantId: quote.variantId,
    amountMinor: quote.amountMinor,
    currency: quote.currency,
    issuedAt,
    expiresAt: quoteExpiry(issuedAt, ttlSeconds),
  };
  const payload = proof.missingCategory === undefined
    ? base
    : { ...base, missingCategory: proof.missingCategory };
  return proofCodec.issue(payload);
}

export async function requestApprovalForProof(
  proof: StyleProof,
  quote: CommerceQuote,
  verifyProof: ProofVerifier,
  requestApproval: ApprovalRequester,
): Promise<{ approvalId: string }> {
  const proofIsValid = await verifyProof(proof);
  if (!proofIsValid) throw new Error("Style Proof is invalid");
  if (!canRequestPayment(proof, quote) || !proofMatchesQuote(proof, quote)) {
    throw new Error("Payment is not allowed for this proof");
  }
  return requestApproval(proof, quote);
}

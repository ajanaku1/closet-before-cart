import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { GarmentCategory, StyleDecision } from "./style-gap.js";
import type { StyleProof } from "../contracts/domain.js";

type ProofInput = {
  readonly caseId: string;
  readonly garmentDigest: string;
  readonly constraintDigest: string;
  readonly ruleVersion: string;
  readonly decision: StyleDecision;
  readonly missingCategory?: GarmentCategory;
  readonly quoteId?: string;
  readonly merchant?: string;
  readonly variantId?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
};

function canonicalPayload(proof: ProofInput & Pick<StyleProof, "issuedAt" | "expiresAt">): string {
  return JSON.stringify({
    caseId: proof.caseId,
    constraintDigest: proof.constraintDigest,
    decision: proof.decision,
    expiresAt: proof.expiresAt,
    garmentDigest: proof.garmentDigest,
    issuedAt: proof.issuedAt,
    missingCategory: proof.missingCategory,
    quoteId: proof.quoteId,
    merchant: proof.merchant,
    variantId: proof.variantId,
    amountMinor: proof.amountMinor,
    currency: proof.currency,
    ruleVersion: proof.ruleVersion,
  });
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueStyleProof(
  input: ProofInput,
  secret: string,
  issuedAt: string,
  ttlSeconds: number,
): StyleProof {
  const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString();
  const proof = {
    ...input,
    proofId: randomUUID(),
    issuedAt,
    expiresAt,
  };

  return { ...proof, signature: sign(canonicalPayload(proof), secret) };
}

export function verifyStyleProof(proof: StyleProof, secret: string, now: string): boolean {
  const nowMs = Date.parse(now);
  const expiryMs = Date.parse(proof.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || nowMs >= expiryMs) return false;

  const expected = sign(canonicalPayload(proof), secret);
  const actualBytes = Buffer.from(proof.signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

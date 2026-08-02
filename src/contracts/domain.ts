import type {
  GarmentCategory,
  GarmentEvidence,
  Formality,
  StyleConstraints,
  StyleDecision,
  StyleGapResult,
} from "../domain/style-gap.js";

export type { GarmentCategory, GarmentEvidence, Formality, StyleConstraints, StyleDecision, StyleGapResult };

export type CaseState =
  | "RECEIVED"
  | "EXTRACTING"
  | "WARDROBE_READY"
  | "RENDERING"
  | "MORE_EVIDENCE"
  | "STYLE_READY"
  | "GAP_FOUND"
  | "QUOTING"
  | "AWAITING_APPROVAL"
  | "PAYMENT_PROCESSING"
  | "SANDBOX_COMPLETED"
  | "ORDER_COMPLETED"
  | "FAILED";

export type StyleRule =
  | "MISSING_REFERENCE_PHOTO"
  | "MISSING_GARMENT_EVIDENCE"
  | "MISSING_CATEGORY"
  | "ALL_CONSTRAINTS_SATISFIED"
  | "MULTIPLE_GAPS"
  | "PURCHASE_NOT_ALLOWED";

export interface StyleProof {
  readonly proofId: string;
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
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface CommerceQuote {
  readonly quoteId: string;
  readonly merchant: string;
  readonly variantId: string;
  readonly size?: string;
  readonly color?: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly available: boolean;
  readonly source: "LIVE" | "PINNED_DEMO";
  readonly retrievedAt: string;
  readonly checkoutUrl?: string;
}

export interface PaymentAttempt {
  readonly attemptId: string;
  readonly caseId: string;
  readonly proofId: string;
  readonly idempotencyKey: string;
  readonly merchant: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly status: "PENDING" | "APPROVED" | "DECLINED" | "FAILED";
}

export interface StyleCase {
  readonly caseId: string;
  readonly senderRef: string;
  readonly state: CaseState;
  readonly constraints: StyleConstraints;
  readonly garments: readonly GarmentEvidence[];
  readonly result?: StyleGapResult;
  readonly retentionDeadline: string;
}

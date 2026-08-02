import type { CommerceQuote, StyleProof } from "./domain.js";
import type { GarmentEvidence, StyleConstraints } from "../domain/style-gap.js";

export interface ExtractedWardrobe {
  readonly garments: readonly GarmentEvidence[];
  readonly missingFields: readonly string[];
}

export interface WardrobeImage {
  readonly attachmentId: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface OpenAIAdapter {
  extractWardrobe(photos: readonly WardrobeImage[]): Promise<ExtractedWardrobe>;
  renderOutfit(referencePhoto: Uint8Array, garments: readonly GarmentEvidence[]): Promise<{ imageUrl: string }>;
}

export interface LinqGateway {
  verifySignature(payload: Uint8Array, signature: string): Promise<boolean>;
  sendReply(senderId: string, message: { text?: string; imageUrl?: string }): Promise<{ messageId: string }>;
}

export interface MediaStore {
  saveTemporary(caseId: string, attachmentId: string, bytes: Uint8Array): Promise<void>;
  deleteCaseMedia(caseId: string): Promise<void>;
}

export interface CommerceAdapter {
  findGapItem(category: string, constraints: StyleConstraints): Promise<CommerceQuote>;
  createCart(quote: CommerceQuote): Promise<{ cartId: string }>;
  getCheckoutHandoff(cartId: string): Promise<{ checkoutUrl: string }>;
  reconcileQuote(quote: CommerceQuote): Promise<CommerceQuote>;
}

export interface ProofCodec {
  issue(payload: Omit<StyleProof, "proofId" | "signature">): Promise<StyleProof>;
  verify(token: string): Promise<StyleProof | null>;
}

export interface PravaGateway {
  requestApproval(
    proof: StyleProof,
    quote: CommerceQuote,
    senderId: string,
  ): Promise<{ approvalId: string; approvalUrl: string }>;
  getResult(approvalId: string): Promise<{
    status: "APPROVED" | "DECLINED" | "PENDING";
    error?: { code: string; message: string };
  }>;
}

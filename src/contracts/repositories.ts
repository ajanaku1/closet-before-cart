import type { CaseState, CommerceQuote, PaymentAttempt, StyleCase, StyleProof } from "./domain.js";

export interface CaseRepository {
  find(caseId: string): Promise<StyleCase | null>;
  transition(caseId: string, from: CaseState, to: CaseState): Promise<boolean>;
  save(caseRecord: StyleCase): Promise<void>;
}

export interface ProofRepository {
  save(proof: StyleProof): Promise<void>;
  find(proofId: string): Promise<StyleProof | null>;
}

export interface QuoteRepository {
  save(quote: CommerceQuote): Promise<void>;
  find(quoteId: string): Promise<CommerceQuote | null>;
}

export interface PaymentRepository {
  save(attempt: PaymentAttempt): Promise<void>;
  findByIdempotencyKey(key: string): Promise<PaymentAttempt | null>;
}

export interface IdempotencyRepository {
  claim(source: "LINQ" | "PRAVA", externalId: string): Promise<boolean>;
}

export interface AuditRepository {
  append(event: {
    caseId: string;
    type: string;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<void>;
}

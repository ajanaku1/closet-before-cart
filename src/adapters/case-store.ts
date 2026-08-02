import { createHash, randomUUID } from "node:crypto";
import type { NormalizedLinqEvent } from "./linq.js";
import type { CommerceQuote, StyleProof } from "../contracts/domain.js";
import type { WardrobeCaseOutcome } from "../domain/case-runner.js";
import type { StyleConstraints } from "../domain/style-gap.js";
import type { ProofPageModel } from "../presentation/proof-page.js";

type Query = (sql: string, values: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

export interface CaseStoreOptions {
  readonly baseUrl: string;
  readonly query: Query;
}

export interface PendingGap {
  readonly proof: StyleProof;
  readonly constraints: StyleConstraints;
}

function senderRef(senderId: string): string {
  return createHash("sha256").update(senderId).digest("hex");
}

function resultRecord(event: NormalizedLinqEvent, outcome: WardrobeCaseOutcome) {
  return {
    decision: outcome.result.decision,
    rule: outcome.result.rule,
    missingCategories: outcome.result.missingCategories,
    usedGarmentIds: outcome.result.usedGarmentIds,
    rawMediaDeleted: outcome.rawMediaDeleted,
    chatId: event.chatId,
    previewDataUrl: outcome.previewUrl,
    proofId: outcome.proof?.proofId,
  };
}

function proofValues(proof: StyleProof): readonly unknown[] {
  return [
    proof.proofId,
    proof.caseId,
    proof.garmentDigest,
    proof.constraintDigest,
    proof.ruleVersion,
    proof.decision,
    proof.missingCategory ?? null,
    proof.quoteId ?? null,
    proof.merchant ?? null,
    proof.variantId ?? null,
    proof.amountMinor ?? null,
    proof.currency ?? null,
    proof.issuedAt,
    proof.expiresAt,
    proof.signature,
  ];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value === "") throw new Error(`Stored ${field} is invalid`);
  return value;
}

function storedDate(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  const date = value instanceof Date ? value : new Date(requiredString(row, field));
  if (!Number.isFinite(date.getTime())) throw new Error(`Stored ${field} is invalid`);
  return date.toISOString();
}

function storedConstraints(value: unknown): StyleConstraints | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const categories = row.requiredCategories;
  const colors = row.excludedColors;
  const validCategories = Array.isArray(categories)
    && categories.every((item) => item === "TOP" || item === "BOTTOM" || item === "SHOES");
  const validColors = Array.isArray(colors) && colors.every((item) => typeof item === "string");
  if (typeof row.occasion !== "string" || !validCategories || !validColors) return undefined;
  if (typeof row.maxNewItems !== "number" || typeof row.referencePhotoPresent !== "boolean") {
    return undefined;
  }
  return row as unknown as StyleConstraints;
}

function pendingProof(row: Record<string, unknown>): StyleProof {
  const missing = requiredString(row, "missing_category");
  if (missing !== "TOP" && missing !== "BOTTOM" && missing !== "SHOES") {
    throw new Error("Stored missing_category is invalid");
  }
  return {
    proofId: requiredString(row, "proof_id"),
    caseId: requiredString(row, "case_id"),
    garmentDigest: requiredString(row, "garment_digest"),
    constraintDigest: requiredString(row, "constraint_digest"),
    ruleVersion: requiredString(row, "rule_version"),
    decision: "GAP_FOUND",
    missingCategory: missing,
    issuedAt: storedDate(row, "issued_at"),
    expiresAt: storedDate(row, "expires_at"),
    signature: requiredString(row, "signature"),
  };
}

function proofDecision(row: Record<string, unknown>): ProofPageModel["decision"] {
  if (row.payment_status === "APPROVED") return "SANDBOX_COMPLETED";
  if (row.decision === "STYLE_READY" || row.decision === "GAP_FOUND") return row.decision;
  throw new Error("Stored proof decision is invalid");
}

function proofFinding(decision: ProofPageModel["decision"], missing?: string): string {
  if (decision === "SANDBOX_COMPLETED") {
    return "The exact sandbox permission was approved. No merchant order was placed.";
  }
  if (decision === "STYLE_READY") {
    return "Your existing wardrobe satisfies the occasion. No purchase is needed.";
  }
  return `Your existing wardrobe has one proven gap: ${missing?.toLowerCase() ?? "one item"}.`;
}

function quoteView(row: Record<string, unknown>): ProofPageModel["quote"] {
  if (row.amount_minor === null || row.amount_minor === undefined) return undefined;
  return {
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    itemName: String(row.variant_id),
    merchant: String(row.merchant),
    source: row.source_mode === "LIVE" ? "LIVE" : "PINNED_DEMO",
  };
}

function proofModel(row: Record<string, unknown>): ProofPageModel {
  const result = typeof row.result === "object" && row.result !== null
    ? row.result as Record<string, unknown>
    : {};
  const decision = proofDecision(row);
  const missing = typeof row.missing_category === "string" ? row.missing_category : undefined;
  const quote = quoteView(row);
  return {
    caseId: String(row.case_id),
    decision,
    finding: proofFinding(decision, missing),
    occasion: "Wedding · no black · one new item maximum",
    ownedItems: stringArray(result.usedGarmentIds),
    ...(missing === undefined ? {} : { missingItem: missing }),
    previewUrl: `/api/preview?case=${encodeURIComponent(String(row.case_id))}`,
    ...(quote === undefined ? {} : { quote }),
  };
}

function decodePreview(value: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

export function createCaseStore(options: CaseStoreOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  return {
    async findPendingGap(senderId: string): Promise<PendingGap | null> {
      const rows = await options.query(
        `select c.id as case_id, c.constraints, p.id as proof_id,
                p.garment_digest, p.constraint_digest, p.rule_version, p.decision,
                p.missing_category, p.issued_at, p.expires_at, p.signature
           from style_cases c
           join style_proofs p on p.case_id = c.id and p.quote_id is null
          where c.sender_ref = $1 and c.state = 'GAP_FOUND'
            and p.decision = 'GAP_FOUND' and p.expires_at > now()
            and not exists (
              select 1 from payment_attempts pa where pa.case_id = c.id
            )
          order by c.updated_at desc, p.created_at desc
          limit 1`,
        [senderRef(senderId)],
      );
      const row = rows[0];
      if (row === undefined) return null;
      const constraints = storedConstraints(row.constraints);
      return constraints === undefined ? null : { proof: pendingProof(row), constraints };
    },

    async saveConstraints(caseId: string, constraints: StyleConstraints): Promise<void> {
      await options.query(
        `update style_cases
            set constraints = $2::jsonb, updated_at = now()
          where id = $1 and state = 'GAP_FOUND'`,
        [caseId, JSON.stringify(constraints)],
      );
    },

    async persist(
      event: NormalizedLinqEvent,
      outcome: WardrobeCaseOutcome,
      constraints: StyleConstraints | Record<string, never> = {},
    ): Promise<{ previewUrl: string; proofUrl: string }> {
      if (!outcome.proof || !outcome.previewUrl) throw new Error("Persisted case requires proof output");
      await options.query(
        `insert into style_cases
          (id, sender_ref, state, constraints, result, retention_deadline)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         on conflict (id) do update set
           state = excluded.state, result = excluded.result, updated_at = now()`,
        [
          event.eventId,
          senderRef(event.senderId),
          outcome.result.decision,
          JSON.stringify(constraints),
          JSON.stringify(resultRecord(event, outcome)),
          outcome.proof.expiresAt,
        ],
      );
      await options.query(
        `insert into style_proofs
          (id, case_id, garment_digest, constraint_digest, rule_version, decision,
           missing_category, quote_id, merchant, variant_id, amount_minor, currency,
           issued_at, expires_at, signature)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (id) do nothing`,
        proofValues(outcome.proof),
      );
      return {
        previewUrl: `${baseUrl}/api/preview?case=${encodeURIComponent(event.eventId)}`,
        proofUrl: `${baseUrl}/api/proof?id=${encodeURIComponent(outcome.proof.proofId)}`,
      };
    },

    async saveApproval(
      quote: CommerceQuote,
      proof: StyleProof,
      approval: { approvalId: string },
    ): Promise<void> {
      await options.query(
        `insert into commerce_quotes
          (id, case_id, merchant, variant_id, size, color, amount_minor, currency,
           available, source_mode, checkout_reference, retrieved_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (id) do nothing`,
        [quote.quoteId, proof.caseId, quote.merchant, quote.variantId, quote.size ?? null,
          quote.color ?? null, quote.amountMinor, quote.currency, quote.available,
          quote.source, quote.checkoutUrl ?? null, quote.retrievedAt],
      );
      await options.query(
        `insert into style_proofs
          (id, case_id, garment_digest, constraint_digest, rule_version, decision,
           missing_category, quote_id, merchant, variant_id, amount_minor, currency,
           issued_at, expires_at, signature)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (id) do nothing`,
        proofValues(proof),
      );
      await options.query(
        `insert into payment_attempts
          (id, case_id, proof_id, idempotency_key, prava_reference, merchant,
           amount_minor, currency, mode, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'SANDBOX', 'PENDING')
         on conflict (idempotency_key) do nothing`,
        [randomUUID(), proof.caseId, proof.proofId, `${proof.proofId}-prava`, approval.approvalId,
          quote.merchant, quote.amountMinor, quote.currency],
      );
    },

    async updateApproval(
      approvalId: string,
      status: "APPROVED" | "DECLINED" | "PENDING",
      safeErrorCode?: string,
    ) {
      await options.query(
        `update payment_attempts
            set status = $2, safe_error_code = $3, updated_at = now()
          where prava_reference = $1 and mode = 'SANDBOX'`,
        [approvalId, status, safeErrorCode ?? null],
      );
    },

    async findProofModel(proofId: string): Promise<ProofPageModel | null> {
      const rows = await options.query(
        `select p.case_id, p.decision, p.missing_category, c.result,
                q.amount_minor, q.currency, q.merchant, q.variant_id, q.source_mode,
                pa.status as payment_status
           from style_proofs p
           join style_cases c on c.id = p.case_id
           left join commerce_quotes q on q.id = p.quote_id
           left join payment_attempts pa on pa.proof_id = p.id
          where p.id = $1 and p.expires_at > now()
          order by pa.created_at desc nulls last
          limit 1`,
        [proofId],
      );
      return rows[0] ? proofModel(rows[0]) : null;
    },

    async findPreview(caseId: string): Promise<{ mimeType: string; bytes: Buffer } | null> {
      const rows = await options.query(
        `select result->>'previewDataUrl' as preview_data_url
           from style_cases where id = $1 and retention_deadline > now()`,
        [caseId],
      );
      return decodePreview(rows[0]?.preview_data_url);
    },
  };
}

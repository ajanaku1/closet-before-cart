import { createHash } from "node:crypto";
import type { MediaStore, OpenAIAdapter, ProofCodec } from "../contracts/adapters.js";
import type { StyleProof } from "../contracts/domain.js";
import { evaluateStyleGap, type StyleConstraints } from "./style-gap.js";

export interface WardrobePhoto {
  readonly attachmentId: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface WardrobeCaseInput {
  readonly caseId: string;
  readonly referencePhotoId: string;
  readonly referencePhoto: Uint8Array;
  readonly wardrobePhotos: readonly WardrobePhoto[];
  readonly constraints: StyleConstraints;
}

export interface WardrobeCaseDependencies {
  readonly openAI: OpenAIAdapter;
  readonly media: MediaStore;
  readonly proofCodec: ProofCodec;
  readonly now: () => string;
  readonly proofTtlSeconds: number;
}

export interface WardrobeCaseOutcome {
  readonly result: ReturnType<typeof evaluateStyleGap>;
  readonly previewUrl?: string;
  readonly proof?: StyleProof;
  readonly rawMediaDeleted: boolean;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expiresAt(issuedAt: string, ttlSeconds: number): string {
  const timestamp = Date.parse(issuedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("proof timestamp or TTL is invalid");
  }
  return new Date(timestamp + ttlSeconds * 1000).toISOString();
}

function proofInput(
  input: WardrobeCaseInput,
  result: ReturnType<typeof evaluateStyleGap>,
  extractedGarments: readonly unknown[],
  issuedAt: string,
  ttlSeconds: number,
): Omit<StyleProof, "proofId" | "signature"> {
  const base = {
    caseId: input.caseId,
    garmentDigest: digest(extractedGarments),
    constraintDigest: digest(input.constraints),
    ruleVersion: "style-rules-v1",
    decision: result.decision,
    issuedAt,
    expiresAt: expiresAt(issuedAt, ttlSeconds),
  };
  const missingCategory = result.missingCategories[0];
  return missingCategory === undefined ? base : { ...base, missingCategory };
}

async function savePhotos(input: WardrobeCaseInput, media: MediaStore): Promise<void> {
  await media.saveTemporary(input.caseId, input.referencePhotoId, input.referencePhoto);
  for (const photo of input.wardrobePhotos) {
    await media.saveTemporary(input.caseId, photo.attachmentId, photo.bytes);
  }
}

export async function runWardrobeCase(
  input: WardrobeCaseInput,
  dependencies: WardrobeCaseDependencies,
): Promise<WardrobeCaseOutcome> {
  let rawMediaDeleted = false;
  try {
    await savePhotos(input, dependencies.media);
    const extraction = await dependencies.openAI.extractWardrobe(
      input.wardrobePhotos.map((photo) => ({
        attachmentId: photo.attachmentId,
        mimeType: photo.mimeType,
        bytes: photo.bytes,
      })),
    );
    const constraints = { ...input.constraints, missingEvidence: extraction.missingFields };
    const result = evaluateStyleGap(extraction.garments, constraints);
    if (result.decision === "MORE_EVIDENCE") {
      await dependencies.media.deleteCaseMedia(input.caseId);
      rawMediaDeleted = true;
      return { result, rawMediaDeleted };
    }

    const preview = await dependencies.openAI.renderOutfit(input.referencePhoto, extraction.garments);
    await dependencies.media.deleteCaseMedia(input.caseId);
    rawMediaDeleted = true;
    const proof = await dependencies.proofCodec.issue(
      proofInput(input, result, extraction.garments, dependencies.now(), dependencies.proofTtlSeconds),
    );
    return { result, previewUrl: preview.imageUrl, proof, rawMediaDeleted };
  } catch (error) {
    if (!rawMediaDeleted) await dependencies.media.deleteCaseMedia(input.caseId);
    throw error;
  }
}

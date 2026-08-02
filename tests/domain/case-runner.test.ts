import assert from "node:assert/strict";
import test from "node:test";
import { runWardrobeCase } from "../../src/domain/case-runner.ts";
import type { OpenAIAdapter, MediaStore, ProofCodec, WardrobeImage } from "../../src/contracts/adapters.ts";

const constraints = {
  occasion: "wedding",
  requiredCategories: ["TOP", "BOTTOM", "SHOES"] as const,
  excludedColors: ["BLACK"],
  maxNewItems: 1,
  referencePhotoPresent: true,
};

const garments = [
  { id: "bottom-1", category: "BOTTOM" as const, color: "NAVY", formality: "FORMAL" as const, confidence: 0.98 },
  { id: "shoes-1", category: "SHOES" as const, color: "BROWN", formality: "FORMAL" as const, confidence: 0.98 },
];

class RecordingMediaStore implements MediaStore {
  readonly saved: string[] = [];
  deleted = 0;

  async saveTemporary(_caseId: string, attachmentId: string, _bytes: Uint8Array): Promise<void> {
    this.saved.push(attachmentId);
  }

  async deleteCaseMedia(_caseId: string): Promise<void> {
    this.deleted += 1;
  }
}

class FixtureOpenAI implements OpenAIAdapter {
  renderCalls = 0;
  extractedMimeTypes: string[] = [];

  async extractWardrobe(photos: readonly WardrobeImage[]) {
    this.extractedMimeTypes = photos.map(({ mimeType }) => mimeType);
    return { garments, missingFields: [] };
  }

  async renderOutfit(_referencePhoto: Uint8Array) {
    this.renderCalls += 1;
    return { imageUrl: "https://images.example.invalid/editorial-preview" };
  }
}

class FixtureProofCodec implements ProofCodec {
  async issue(payload: Parameters<ProofCodec["issue"]>[0]) {
    return { ...payload, proofId: "proof-1", signature: "fixture" };
  }

  async verify(_token: string) {
    return null;
  }
}

test("renders a deterministic GAP_FOUND case and deletes raw media after rendering", async () => {
  const media = new RecordingMediaStore();
  const openAI = new FixtureOpenAI();
  const outcome = await runWardrobeCase(
    {
      caseId: "case-1",
      referencePhotoId: "reference-1",
      referencePhoto: new Uint8Array([1]),
      wardrobePhotos: [
        { attachmentId: "photo-1", mimeType: "image/png", bytes: new Uint8Array([2]) },
        { attachmentId: "photo-2", mimeType: "image/jpeg", bytes: new Uint8Array([3]) },
      ],
      constraints,
    },
    {
      openAI,
      media,
      proofCodec: new FixtureProofCodec(),
      now: () => "2026-08-01T12:00:00Z",
      proofTtlSeconds: 900,
    },
  );

  assert.equal(outcome.result.decision, "GAP_FOUND");
  assert.equal(outcome.result.paymentAllowed, true);
  assert.equal(outcome.previewUrl, "https://images.example.invalid/editorial-preview");
  assert.equal(outcome.rawMediaDeleted, true);
  assert.equal(openAI.renderCalls, 1);
  assert.deepEqual(openAI.extractedMimeTypes, ["image/png", "image/jpeg"]);
  assert.equal(media.deleted, 1);
  assert.deepEqual(media.saved, ["reference-1", "photo-1", "photo-2"]);
});

test("stops at MORE_EVIDENCE and deletes media after extraction", async () => {
  const media = new RecordingMediaStore();
  const openAI: OpenAIAdapter = {
    async extractWardrobe() {
      return { garments, missingFields: ["formality"] };
    },
    async renderOutfit() {
      throw new Error("render must not run");
    },
  };

  const outcome = await runWardrobeCase(
    {
      caseId: "case-2",
      referencePhotoId: "reference-2",
      referencePhoto: new Uint8Array([1]),
      wardrobePhotos: [{ attachmentId: "photo-1", mimeType: "image/jpeg", bytes: new Uint8Array([2]) }],
      constraints,
    },
    {
      openAI,
      media,
      proofCodec: new FixtureProofCodec(),
      now: () => "2026-08-01T12:00:00Z",
      proofTtlSeconds: 900,
    },
  );

  assert.equal(outcome.result.decision, "MORE_EVIDENCE");
  assert.equal(outcome.previewUrl, undefined);
  assert.equal(outcome.proof, undefined);
  assert.equal(outcome.rawMediaDeleted, true);
  assert.equal(media.deleted, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseGarmentEvidence, parseWardrobeExtraction } from "../../src/domain/garments.ts";

const validGarment = {
  id: "top-1",
  category: "TOP",
  color: "WHITE",
  pattern: "SOLID",
  formality: "FORMAL",
  weatherSuitability: "MILD",
  confidence: 0.97,
  sourceAttachmentId: "attachment-1",
};

test("normalizes a strict garment record and derives a stable digest", () => {
  const garment = parseGarmentEvidence(validGarment);

  assert.equal(garment.category, "TOP");
  assert.equal(garment.sourceAttachmentId, "attachment-1");
  assert.match(garment.digest, /^[a-f0-9]{64}$/);
});

test("rejects invalid garment facts instead of guessing", () => {
  assert.throws(
    () => parseGarmentEvidence({ ...validGarment, confidence: 1.1 }),
    /confidence/i,
  );
  assert.throws(
    () => parseGarmentEvidence({ ...validGarment, category: "DRESS" }),
    /category/i,
  );
  assert.throws(
    () => parseGarmentEvidence({ ...validGarment, sourceAttachmentId: "" }),
    /sourceAttachmentId/i,
  );
});

test("preserves model-reported missing fields for MORE_EVIDENCE", () => {
  const extraction = parseWardrobeExtraction({
    garments: [validGarment],
    missingFields: ["weatherSuitability"],
  });

  assert.equal(extraction.garments.length, 1);
  assert.deepEqual(extraction.missingFields, ["weatherSuitability"]);
});

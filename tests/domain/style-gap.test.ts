import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStyleGap } from "../../src/domain/style-gap.ts";

const constraints = {
  occasion: "wedding",
  requiredCategories: ["TOP", "BOTTOM", "SHOES"] as const,
  excludedColors: ["BLACK"] as const,
  maxNewItems: 1,
  referencePhotoPresent: true,
};

test("returns STYLE_READY when owned garments satisfy every constraint", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "WHITE", formality: "FORMAL", confidence: 0.98 },
      { id: "bottom-1", category: "BOTTOM", color: "NAVY", formality: "FORMAL", confidence: 0.98 },
      { id: "shoes-1", category: "SHOES", color: "BROWN", formality: "FORMAL", confidence: 0.98 },
    ],
    constraints,
  );

  assert.equal(result.decision, "STYLE_READY");
  assert.equal(result.paymentAllowed, false);
  assert.deepEqual(result.missingCategories, []);
});

test("returns GAP_FOUND for exactly one missing category", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "WHITE", formality: "FORMAL", confidence: 0.98 },
      { id: "shoes-1", category: "SHOES", color: "BROWN", formality: "FORMAL", confidence: 0.98 },
    ],
    constraints,
  );

  assert.deepEqual(result, {
    decision: "GAP_FOUND",
    paymentAllowed: true,
    rule: "MISSING_CATEGORY",
    missingCategories: ["BOTTOM"],
    usedGarmentIds: ["top-1", "shoes-1"],
  });
});

test("returns MORE_EVIDENCE when the reference photo is missing", () => {
  const result = evaluateStyleGap([], { ...constraints, referencePhotoPresent: false });

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.equal(result.paymentAllowed, false);
  assert.equal(result.rule, "MISSING_REFERENCE_PHOTO");
});

test("treats a casual garment as a gap for a formal occasion", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "WHITE", formality: "CASUAL", confidence: 0.98 },
      { id: "bottom-1", category: "BOTTOM", color: "NAVY", formality: "FORMAL", confidence: 0.98 },
      { id: "shoes-1", category: "SHOES", color: "BROWN", formality: "FORMAL", confidence: 0.98 },
    ],
    { ...constraints, minimumFormality: "FORMAL" },
  );

  assert.deepEqual(result.missingCategories, ["TOP"]);
  assert.equal(result.decision, "GAP_FOUND");
});

test("accepts smart separates for a non-black-tie wedding", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "WHITE", formality: "FORMAL", confidence: 0.98 },
      { id: "bottom-1", category: "BOTTOM", color: "BEIGE", formality: "SMART", confidence: 0.97 },
    ],
    { ...constraints, minimumFormality: "SMART" },
  );

  assert.equal(result.decision, "GAP_FOUND");
  assert.deepEqual(result.missingCategories, ["SHOES"]);
});

test("does not block a verdict for missing non-decision garment details", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "WHITE", formality: "FORMAL", confidence: 0.98 },
      { id: "bottom-1", category: "BOTTOM", color: "NAVY", formality: "FORMAL", confidence: 0.98 },
      { id: "shoes-1", category: "SHOES", color: "BROWN", formality: "FORMAL", confidence: 0.98 },
    ],
    { ...constraints, missingEvidence: ["photo-1.weatherSuitability", "photo-2.pattern"] },
  );

  assert.equal(result.decision, "STYLE_READY");
});

test("still requires more evidence when a decision-critical field is missing", () => {
  const result = evaluateStyleGap(
    [{ id: "top-1", category: "TOP", color: "WHITE", formality: "FORMAL", confidence: 0.98 }],
    { ...constraints, missingEvidence: ["photo-1.formality"] },
  );

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.equal(result.rule, "MISSING_GARMENT_EVIDENCE");
});

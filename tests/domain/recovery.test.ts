import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStyleGap } from "../../src/domain/style-gap.ts";

test("an excluded color creates a one-item style gap", () => {
  const result = evaluateStyleGap(
    [
      { id: "top-1", category: "TOP", color: "BLACK", formality: "FORMAL", confidence: 0.98 },
      { id: "bottom-1", category: "BOTTOM", color: "NAVY", formality: "FORMAL", confidence: 0.98 },
      { id: "shoes-1", category: "SHOES", color: "BROWN", formality: "FORMAL", confidence: 0.98 },
    ],
    {
      occasion: "wedding",
      requiredCategories: ["TOP", "BOTTOM", "SHOES"],
      excludedColors: ["BLACK"],
      maxNewItems: 1,
      referencePhotoPresent: true,
    },
  );

  assert.equal(result.decision, "GAP_FOUND");
  assert.equal(result.paymentAllowed, true);
  assert.deepEqual(result.missingCategories, ["TOP"]);
});

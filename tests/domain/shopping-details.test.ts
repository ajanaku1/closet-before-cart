import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeShoppingDetails,
  shoppingDetailsPrompt,
} from "../../src/domain/shopping-details.ts";
import type { StyleConstraints } from "../../src/domain/style-gap.ts";

const constraints: StyleConstraints = {
  occasion: "Friday wedding",
  requiredCategories: ["TOP", "BOTTOM", "SHOES"],
  excludedColors: ["BLACK"],
  maxNewItems: 1,
  referencePhotoPresent: true,
  minimumFormality: "SMART",
};

test("asks for every missing detail needed to shop Everlane footwear", () => {
  const prompt = shoppingDetailsPrompt("SHOES", constraints);

  assert.match(prompt ?? "", /missing item: shoes suitable for your Friday wedding/i);
  assert.match(prompt ?? "", /other required categories/i);
  assert.match(prompt ?? "", /no eligible shoes/i);
  assert.match(prompt ?? "", /smart dress level/i);
  assert.match(prompt ?? "", /no-black rule/i);
  assert.match(prompt ?? "", /one new item/i);
  assert.doesNotMatch(prompt ?? "", /Everlane/i);
  assert.match(prompt ?? "", /search for an option/i);
  assert.match(prompt ?? "", /men's or women's/i);
  assert.match(prompt ?? "", /US shoe size/i);
  assert.match(prompt ?? "", /maximum budget/i);
});

test("parses a compact shopping-details reply and completes the requirements", () => {
  const updated = mergeShoppingDetails(
    constraints,
    "Men's, US shoe size 10.5, maximum budget $200",
  );

  assert.equal(updated.shoppingDepartment, "MEN");
  assert.equal(updated.shoppingSize, "10.5");
  assert.equal(updated.maxPriceMinor, 20_000);
  assert.equal(shoppingDetailsPrompt("SHOES", updated), undefined);
});

test("keeps unanswered fields pending instead of guessing", () => {
  const updated = mergeShoppingDetails(constraints, "Men's, size 10");
  const prompt = shoppingDetailsPrompt("SHOES", updated);

  assert.equal(updated.maxPriceMinor, undefined);
  assert.match(prompt ?? "", /missing item: shoes/i);
  assert.doesNotMatch(prompt ?? "", /men's or women's/i);
  assert.doesNotMatch(prompt ?? "", /shoe size/i);
  assert.match(prompt ?? "", /maximum budget/i);
});

test("rejects ambiguous or unsafe shopping values", () => {
  assert.throws(
    () => mergeShoppingDetails(constraints, "men's and women's, size 10, budget $200"),
    /department/i,
  );
  assert.throws(
    () => mergeShoppingDetails(constraints, "men's, size 10, budget $0"),
    /budget/i,
  );
  assert.throws(
    () => mergeShoppingDetails(constraints, "men's, size 44, budget $70", "SHOES"),
    /valid US shoe size/i,
  );
});

import type { GarmentCategory, StyleConstraints } from "./style-gap.js";

export class ShoppingDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingDetailsError";
  }
}

function department(text: string): "MEN" | "WOMEN" | undefined {
  const men = /\b(?:men|men's|mens|male)\b/i.test(text);
  const women = /\b(?:women|women's|womens|female)\b/i.test(text);
  if (men && women) throw new Error("Shopping department must be men's or women's, not both");
  if (men) return "MEN";
  return women ? "WOMEN" : undefined;
}

function size(text: string): string | undefined {
  const match = /\b(?:US\s+)?(?:shoe\s+)?size\s*[:=-]?\s*(\d{1,2}(?:\.5)?)\b/i.exec(text);
  return match?.[1];
}

function budget(text: string): number | undefined {
  const match = /(?:\b(?:budget|max(?:imum)?|under|up to)\b[^\d$]{0,12}|\$)\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(text);
  if (!match?.[1]) return undefined;
  const amountMinor = Math.round(Number(match[1]) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Shopping budget must be greater than zero");
  }
  return amountMinor;
}

export function mergeShoppingDetails(
  constraints: StyleConstraints,
  text: string,
  category?: GarmentCategory,
): StyleConstraints {
  const parsedDepartment = department(text);
  const parsedSize = size(text);
  const parsedBudget = budget(text);
  if (category === "SHOES" && parsedSize !== undefined) {
    const numericSize = Number(parsedSize);
    if (numericSize < 4 || numericSize > 18) {
      throw new ShoppingDetailsError("Please provide a valid US shoe size from 4 to 18");
    }
  }
  return {
    ...constraints,
    ...(parsedDepartment === undefined ? {} : { shoppingDepartment: parsedDepartment }),
    ...(parsedSize === undefined ? {} : { shoppingSize: parsedSize }),
    ...(parsedBudget === undefined ? {} : { maxPriceMinor: parsedBudget }),
  };
}

const categoryNames: Record<GarmentCategory, string> = {
  TOP: "top",
  BOTTOM: "bottom piece",
  SHOES: "shoes",
};

function eligibilityRules(constraints: StyleConstraints): string {
  const rules: string[] = [];
  if (constraints.minimumFormality !== undefined) {
    rules.push(`${constraints.minimumFormality.toLowerCase()} dress level`);
  }
  if (constraints.excludedColors.includes("BLACK")) rules.push("no-black rule");
  if (rules.length === 0) return "the occasion requirements";
  return rules.length === 1 ? rules[0] ?? "the occasion requirements" : `${rules[0]} and ${rules[1]}`;
}

function gapExplanation(
  category: GarmentCategory,
  constraints: StyleConstraints,
): string {
  const item = categoryNames[category];
  const verb = category === "SHOES" ? "are" : "is";
  const allowance = constraints.maxNewItems === 1 ? "one new item" : `${constraints.maxNewItems} new items`;
  return [
    `Missing item: ${item} suitable for your ${constraints.occasion}.`,
    `Your wardrobe has suitable pieces in the other required categories, but no eligible ${item} met the combined ${eligibilityRules(constraints)}.`,
    `Because your brief allows ${allowance}, ${item} ${verb} the only item CBC will search for.`,
  ].join(" ");
}

export function shoppingDetailsPrompt(
  category: GarmentCategory,
  constraints: StyleConstraints,
): string | undefined {
  const missing: string[] = [];
  if (constraints.shoppingDepartment === undefined) missing.push("men's or women's department");
  if (constraints.shoppingSize === undefined) {
    missing.push(category === "SHOES" ? "US shoe size" : "size");
  }
  if (constraints.maxPriceMinor === undefined) missing.push("maximum budget in USD");
  if (missing.length === 0) return undefined;
  return `${gapExplanation(category, constraints)} Before I search for an option, please reply with: ${missing.join(", ")}.`;
}

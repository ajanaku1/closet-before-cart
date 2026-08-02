export type GarmentCategory = "TOP" | "BOTTOM" | "SHOES";
export type Formality = "CASUAL" | "SMART" | "FORMAL";
export type StyleDecision = "MORE_EVIDENCE" | "STYLE_READY" | "GAP_FOUND";

export interface GarmentEvidence {
  readonly id: string;
  readonly category: GarmentCategory;
  readonly color: string;
  readonly formality: Formality;
  readonly confidence: number;
}

export interface StyleConstraints {
  readonly occasion: string;
  readonly requiredCategories: readonly GarmentCategory[];
  readonly excludedColors: readonly string[];
  readonly maxNewItems: number;
  readonly referencePhotoPresent: boolean;
  readonly missingEvidence?: readonly string[];
  readonly minimumFormality?: Formality;
  readonly shoppingDepartment?: "MEN" | "WOMEN";
  readonly shoppingSize?: string;
  readonly maxPriceMinor?: number;
}

export interface StyleGapResult {
  readonly decision: StyleDecision;
  readonly paymentAllowed: boolean;
  readonly rule:
    | "MISSING_REFERENCE_PHOTO"
    | "MISSING_GARMENT_EVIDENCE"
    | "MISSING_CATEGORY"
    | "ALL_CONSTRAINTS_SATISFIED"
    | "MULTIPLE_GAPS"
    | "PURCHASE_NOT_ALLOWED";
  readonly missingCategories: readonly GarmentCategory[];
  readonly usedGarmentIds: readonly string[];
}

function evidenceResult(
  rule: "MISSING_REFERENCE_PHOTO" | "MISSING_GARMENT_EVIDENCE" | "MULTIPLE_GAPS" | "PURCHASE_NOT_ALLOWED",
  missingCategories: readonly GarmentCategory[] = [],
  usedGarmentIds: readonly string[] = [],
): StyleGapResult {
  return {
    decision: "MORE_EVIDENCE",
    paymentAllowed: false,
    rule,
    missingCategories,
    usedGarmentIds,
  };
}

function eligibleGarments(
  garments: readonly GarmentEvidence[],
  excludedColors: readonly string[],
  minimumFormality: Formality,
): readonly GarmentEvidence[] {
  const excluded = new Set(excludedColors.map((color) => color.toUpperCase()));
  const formalityRank: Record<Formality, number> = { CASUAL: 1, SMART: 2, FORMAL: 3 };
  return garments.filter(
    (garment) =>
      !excluded.has(garment.color.toUpperCase()) &&
      formalityRank[garment.formality] >= formalityRank[minimumFormality],
  );
}

function styleReadyResult(usedGarmentIds: readonly string[]): StyleGapResult {
  return {
    decision: "STYLE_READY",
    paymentAllowed: false,
    rule: "ALL_CONSTRAINTS_SATISFIED",
    missingCategories: [],
    usedGarmentIds,
  };
}

function gapFoundResult(
  missingCategories: readonly GarmentCategory[],
  usedGarmentIds: readonly string[],
): StyleGapResult {
  return {
    decision: "GAP_FOUND",
    paymentAllowed: true,
    rule: "MISSING_CATEGORY",
    missingCategories,
    usedGarmentIds,
  };
}

function missingCategories(
  eligible: readonly GarmentEvidence[],
  required: readonly GarmentCategory[],
): readonly GarmentCategory[] {
  return required.filter((category) => !eligible.some((garment) => garment.category === category));
}

function usedGarmentIds(
  eligible: readonly GarmentEvidence[],
  required: readonly GarmentCategory[],
): readonly string[] {
  return eligible
    .filter((garment) => required.includes(garment.category))
    .map((garment) => garment.id);
}

function classifyEligibleGarments(
  eligible: readonly GarmentEvidence[],
  constraints: StyleConstraints,
): StyleGapResult {
  const missing = missingCategories(eligible, constraints.requiredCategories);
  const used = usedGarmentIds(eligible, constraints.requiredCategories);

  if (missing.length === 0) {
    return styleReadyResult(used);
  }

  if (missing.length === 1 && constraints.maxNewItems >= 1) {
    return gapFoundResult(missing, used);
  }

  return evidenceResult(
    constraints.maxNewItems < 1 ? "PURCHASE_NOT_ALLOWED" : "MULTIPLE_GAPS",
    missing,
    used,
  );
}

function hasDecisionCriticalGap(fields: readonly string[] | undefined): boolean {
  return fields?.some((field) =>
    /(?:^|[.:])(category|color|formality)$/i.test(field.trim())) ?? false;
}

export function evaluateStyleGap(
  garments: readonly GarmentEvidence[],
  constraints: StyleConstraints,
): StyleGapResult {
  if (hasDecisionCriticalGap(constraints.missingEvidence)) {
    return evidenceResult("MISSING_GARMENT_EVIDENCE");
  }
  if (!constraints.referencePhotoPresent || !constraints.occasion.trim()) {
    return evidenceResult("MISSING_REFERENCE_PHOTO");
  }

  if (garments.some((garment) => garment.confidence < 0.8)) {
    return evidenceResult("MISSING_REFERENCE_PHOTO");
  }

  return classifyEligibleGarments(
    eligibleGarments(
      garments,
      constraints.excludedColors,
      constraints.minimumFormality ?? "CASUAL",
    ),
    constraints,
  );
}

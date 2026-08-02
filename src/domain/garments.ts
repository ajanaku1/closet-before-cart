import { createHash } from "node:crypto";
import type { GarmentCategory, GarmentEvidence, Formality } from "./style-gap.js";

export type GarmentPattern = "SOLID" | "STRIPED" | "CHECK" | "PRINT" | "UNKNOWN";
export type WeatherSuitability = "WARM" | "MILD" | "COLD" | "ALL";

export interface StrictGarmentEvidence extends GarmentEvidence {
  readonly pattern: GarmentPattern;
  readonly weatherSuitability: WeatherSuitability;
  readonly sourceAttachmentId: string;
  readonly digest: string;
}

export interface ParsedWardrobeExtraction {
  readonly garments: readonly StrictGarmentEvidence[];
  readonly missingFields: readonly string[];
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, context: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as RecordValue;
}

function requiredString(record: RecordValue, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function enumValue<T extends string>(record: RecordValue, field: string, values: readonly T[]): T {
  const value = requiredString(record, field).toUpperCase();
  if (!values.includes(value as T)) throw new Error(`${field} is unsupported`);
  return value as T;
}

function confidence(record: RecordValue): number {
  const value = record.confidence;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }
  return value;
}

function digestGarment(garment: Omit<StrictGarmentEvidence, "digest">): string {
  const canonical = JSON.stringify({
    category: garment.category,
    color: garment.color,
    formality: garment.formality,
    id: garment.id,
    pattern: garment.pattern,
    sourceAttachmentId: garment.sourceAttachmentId,
    weatherSuitability: garment.weatherSuitability,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseGarmentEvidence(value: unknown): StrictGarmentEvidence {
  const record = asRecord(value, "garment");
  const garment = {
    id: requiredString(record, "id"),
    category: enumValue<GarmentCategory>(record, "category", ["TOP", "BOTTOM", "SHOES"]),
    color: requiredString(record, "color").toUpperCase(),
    pattern: enumValue<GarmentPattern>(record, "pattern", ["SOLID", "STRIPED", "CHECK", "PRINT", "UNKNOWN"]),
    formality: enumValue<Formality>(record, "formality", ["CASUAL", "SMART", "FORMAL"]),
    weatherSuitability: enumValue<WeatherSuitability>(record, "weatherSuitability", ["WARM", "MILD", "COLD", "ALL"]),
    confidence: confidence(record),
    sourceAttachmentId: requiredString(record, "sourceAttachmentId"),
  };
  return { ...garment, digest: digestGarment(garment) };
}

export function parseWardrobeExtraction(value: unknown): ParsedWardrobeExtraction {
  const record = asRecord(value, "wardrobe extraction");
  if (!Array.isArray(record.garments)) throw new Error("garments must be an array");
  if (!Array.isArray(record.missingFields) || record.missingFields.some((field) => typeof field !== "string")) {
    throw new Error("missingFields must be an array of strings");
  }
  return {
    garments: record.garments.map(parseGarmentEvidence),
    missingFields: record.missingFields,
  };
}

import type { ExtractedWardrobe, WardrobeImage } from "../contracts/adapters.js";
import type { GarmentEvidence } from "../domain/style-gap.js";
import { parseWardrobeExtraction } from "../domain/garments.js";

const responsesUrl = "https://api.openai.com/v1/responses";
const extractionModel = "gpt-5.6-sol";
const imageModel = "gpt-5.6";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type RecordValue = Record<string, unknown>;

export interface OpenAIWardrobeAdapterOptions {
  readonly apiKey: string;
  readonly fetch?: Fetcher;
  readonly safetyIdentifier?: string;
}

function imageDataUrl(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

function renderRequestBody(referencePhoto: Uint8Array, garments: readonly GarmentEvidence[]) {
  const evidence = garments.map(({ category, color, formality }) => ({
    category,
    color,
    formality,
  }));
  return {
    model: imageModel,
    store: false,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Edit this synthetic reference photo into a tasteful full-body outfit preview. Use only this garment evidence: ${JSON.stringify(evidence)}. Preserve the person's identity and pose. Do not add text or logos.`,
        },
        { type: "input_image", image_url: imageDataUrl(referencePhoto) },
      ],
    }],
    tools: [{ type: "image_generation", action: "edit", quality: "medium" }],
    tool_choice: { type: "image_generation" },
  };
}

function generatedImage(value: unknown): string {
  const response = asRecord(value, "OpenAI response");
  if (!Array.isArray(response.output)) throw new Error("OpenAI response output is missing");
  for (const output of response.output) {
    const item = asRecord(output, "OpenAI output");
    if (item.type === "image_generation_call" && typeof item.result === "string" && item.result !== "") {
      return `data:image/png;base64,${item.result}`;
    }
  }
  throw new Error("OpenAI response contained no generated image");
}

const garmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceAttachmentId: { type: "string" },
    category: { type: "string", enum: ["TOP", "BOTTOM", "SHOES"] },
    color: { type: "string" },
    pattern: { type: "string", enum: ["SOLID", "STRIPED", "CHECK", "PRINT", "UNKNOWN"] },
    formality: { type: "string", enum: ["CASUAL", "SMART", "FORMAL"] },
    weatherSuitability: { type: "string", enum: ["WARM", "MILD", "COLD", "ALL"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "sourceAttachmentId",
    "category",
    "color",
    "pattern",
    "formality",
    "weatherSuitability",
    "confidence",
  ],
} as const;

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    garments: { type: "array", items: garmentSchema },
    missingFields: {
      type: "array",
      items: { type: "string", enum: ["category", "color", "formality"] },
    },
  },
  required: ["garments", "missingFields"],
} as const;

function asRecord(value: unknown, context: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as RecordValue;
}

function outputText(value: unknown): string {
  const response = asRecord(value, "OpenAI response");
  if (!Array.isArray(response.output)) throw new Error("OpenAI response output is missing");
  for (const output of response.output) {
    const message = asRecord(output, "OpenAI output");
    if (!Array.isArray(message.content)) continue;
    for (const content of message.content) {
      const item = asRecord(content, "OpenAI content");
      if (item.type === "output_text" && typeof item.text === "string") return item.text;
    }
  }
  throw new Error("OpenAI response contained no output text");
}

function imageContent(photo: WardrobeImage): RecordValue {
  if (!photo.mimeType.startsWith("image/") || photo.bytes.byteLength === 0) {
    throw new Error(`Invalid wardrobe image ${photo.attachmentId}`);
  }
  return {
    type: "input_image",
    detail: "high",
    image_url: `data:${photo.mimeType};base64,${Buffer.from(photo.bytes).toString("base64")}`,
  };
}

function requestBody(photos: readonly WardrobeImage[], safetyIdentifier?: string): RecordValue {
  const labels = photos.map(({ attachmentId }) => attachmentId).join(", ");
  const base = {
    model: extractionModel,
    store: false,
    reasoning: { effort: "low" },
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Extract exactly one garment per image, in the same order as the images. Use one supplied sourceAttachmentId per result: ${labels}. Only report category, color, or formality in missingFields when that decision-critical fact cannot be determined. Never decide whether a purchase is needed.`,
        },
        ...photos.map(imageContent),
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "wardrobe_extraction",
        strict: true,
        schema: extractionSchema,
      },
    },
  };
  return safetyIdentifier ? { ...base, safety_identifier: safetyIdentifier } : base;
}

function sourceAttachmentIds(
  garments: readonly RecordValue[],
  photos: readonly WardrobeImage[],
): readonly string[] {
  const knownIds = new Set(photos.map(({ attachmentId }) => attachmentId));
  const ids = garments.map(({ sourceAttachmentId }) => {
    if (typeof sourceAttachmentId !== "string" || !knownIds.has(sourceAttachmentId)) {
      throw new Error("OpenAI returned an unknown source attachment");
    }
    return sourceAttachmentId;
  });
  if (new Set(ids).size === ids.length) return ids;
  if (garments.length !== photos.length) {
    throw new Error("OpenAI returned a duplicate source attachment");
  }
  return photos.map(({ attachmentId }) => attachmentId);
}

function normalizeExtraction(value: unknown, photos: readonly WardrobeImage[]): ExtractedWardrobe {
  const parsed = asRecord(JSON.parse(outputText(value)) as unknown, "wardrobe extraction");
  if (!Array.isArray(parsed.garments)) throw new Error("garments must be an array");
  const records = parsed.garments.map((garment) => asRecord(garment, "garment"));
  const sourceIds = sourceAttachmentIds(records, photos);
  const garments = records.map((garment, index) => {
    const sourceAttachmentId = sourceIds[index] as string;
    return { ...garment, sourceAttachmentId, id: `garment-${sourceAttachmentId}` };
  });
  return parseWardrobeExtraction({ garments, missingFields: parsed.missingFields });
}

export function createOpenAIWardrobeAdapter(options: OpenAIWardrobeAdapterOptions): {
  extractWardrobe(photos: readonly WardrobeImage[]): Promise<ExtractedWardrobe>;
  renderOutfit(referencePhoto: Uint8Array, garments: readonly GarmentEvidence[]): Promise<{ imageUrl: string }>;
} {
  if (!options.apiKey.trim()) throw new Error("OpenAI API key is required");
  const fetcher = options.fetch ?? fetch;
  return {
    async extractWardrobe(photos): Promise<ExtractedWardrobe> {
      if (photos.length === 0) throw new Error("At least one wardrobe image is required");
      const response = await fetcher(responsesUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody(photos, options.safetyIdentifier)),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`OpenAI wardrobe extraction failed (${response.status})`);
      return normalizeExtraction(await response.json(), photos);
    },
    async renderOutfit(referencePhoto, garments): Promise<{ imageUrl: string }> {
      if (referencePhoto.byteLength === 0) throw new Error("Reference image is required");
      const response = await fetcher(responsesUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(renderRequestBody(referencePhoto, garments)),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`OpenAI outfit rendering failed (${response.status})`);
      return { imageUrl: generatedImage(await response.json()) };
    },
  };
}

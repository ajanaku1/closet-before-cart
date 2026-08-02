import type { LinqAttachment, NormalizedLinqEvent } from "../adapters/linq.js";
import type { WardrobeImage } from "../contracts/adapters.js";
import type { StyleConstraints } from "./style-gap.js";

const expectedAttachmentCount = 7;
const defaultMaxBytes = 8_000_000;
const defaultTimeoutMs = 10_000;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface WardrobeIntakeOptions {
  readonly allowedHosts: readonly string[];
  readonly fetch?: Fetcher;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

export interface PreparedWardrobeIntake {
  readonly referencePhoto: WardrobeImage;
  readonly wardrobePhotos: readonly WardrobeImage[];
  readonly constraints: StyleConstraints;
}

function parseConstraints(text: string | undefined): StyleConstraints {
  const parts = text?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  const occasion = parts[0];
  const hasOneItemLimit = parts.some((part) => /^(?:one|1) new item (?:maximum|max)$/i.test(part));
  if (!occasion || !/\bwedding\b/i.test(occasion) || !hasOneItemLimit) {
    throw new Error("A supported occasion and one-item limit are required");
  }
  const excludedColors = parts.flatMap((part) => {
    const match = /^no\s+([a-z]+)$/i.exec(part);
    return match?.[1] ? [match[1].toUpperCase()] : [];
  });
  return {
    occasion,
    requiredCategories: ["TOP", "BOTTOM", "SHOES"],
    excludedColors,
    maxNewItems: 1,
    referencePhotoPresent: true,
    minimumFormality: "SMART",
  };
}

function attachmentUrl(attachment: LinqAttachment, allowedHosts: ReadonlySet<string>): URL {
  const url = new URL(attachment.url);
  if (url.protocol !== "https:") throw new Error("Attachment URL must use HTTPS");
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Attachment host is not allowed");
  }
  if (!supportedImageTypes.has(attachment.mimeType.toLowerCase())) {
    throw new Error("Unsupported image format");
  }
  return url;
}

function contentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function downloadImage(
  attachment: LinqAttachment,
  url: URL,
  fetcher: Fetcher,
  maxBytes: number,
  timeoutMs: number,
): Promise<WardrobeImage> {
  const response = await fetcher(url.href, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Linq attachment fetch failed (${response.status})`);
  const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (!responseType?.startsWith("image/") || responseType !== attachment.mimeType.toLowerCase()) {
    throw new Error("Linq attachment content type did not match");
  }
  if ((contentLength(response) ?? 0) > maxBytes) throw new Error("Linq attachment is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error("Linq attachment is too large");
  }
  return { attachmentId: attachment.id, mimeType: responseType, bytes };
}

export async function prepareWardrobeIntake(
  event: NormalizedLinqEvent,
  options: WardrobeIntakeOptions,
): Promise<PreparedWardrobeIntake> {
  if (event.attachments.length !== expectedAttachmentCount) {
    throw new Error("Seven image attachments are required");
  }
  const constraints = parseConstraints(event.text);
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  if (allowedHosts.size === 0) throw new Error("At least one Linq media host is required");
  const urls = event.attachments.map((attachment) => attachmentUrl(attachment, allowedHosts));
  const fetcher = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const photos = await Promise.all(event.attachments.map((attachment, index) =>
    downloadImage(attachment, urls[index] as URL, fetcher, maxBytes, timeoutMs)));
  const referencePhoto = photos[0];
  if (!referencePhoto) throw new Error("Reference photo is missing");
  return { referencePhoto, wardrobePhotos: photos.slice(1), constraints };
}

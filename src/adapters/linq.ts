import { createHmac, timingSafeEqual } from "node:crypto";

export interface LinqAttachment {
  readonly id: string;
  readonly url: string;
  readonly mimeType: string;
}

export interface NormalizedLinqEvent {
  readonly eventId: string;
  readonly senderId: string;
  readonly chatId?: string;
  readonly messageId?: string;
  readonly text?: string;
  readonly attachments: readonly LinqAttachment[];
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, context: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as RecordValue;
}

function stringField(record: RecordValue, fields: readonly string[], context: string): string {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  throw new Error(`${context} is missing`);
}

function optionalString(record: RecordValue, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function optionalHandle(record: RecordValue, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const handle = optionalString(value as RecordValue, ["handle"]);
    if (handle !== undefined) return handle;
  }
  return undefined;
}

function signingKey(secret: string): Buffer | null {
  const encoded = secret.replace(/^whsec_/, "");
  if (encoded === "") return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 0 ? null : key;
}

function timestampIsFresh(timestamp: string, nowSeconds: number): boolean {
  const signedAt = Number(timestamp);
  return Number.isInteger(signedAt)
    && Number.isFinite(nowSeconds)
    && Math.abs(nowSeconds - signedAt) <= 300;
}

function hasMatchingSignature(header: string, expected: Buffer): boolean {
  return header.split(" ").some((candidate) => {
    if (!candidate.startsWith("v1,")) return false;
    const actual = Buffer.from(candidate.slice(3), "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function verifyLinqWebhookSignature(
  body: Uint8Array,
  headers: Headers,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const eventId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!eventId || !timestamp || !signature || !secret) return false;
  if (!timestampIsFresh(timestamp, nowSeconds)) return false;
  const key = signingKey(secret);
  if (!key) return false;
  const expected = createHmac("sha256", key)
    .update(`${eventId}.${timestamp}.`)
    .update(body)
    .digest();
  return hasMatchingSignature(signature, expected);
}

function parseAttachment(value: unknown): LinqAttachment {
  const record = asRecord(value, "attachment");
  const attachment = {
    id: stringField(record, ["id", "attachment_id"], "attachment id"),
    url: stringField(record, ["url", "download_url"], "attachment url"),
    mimeType: stringField(record, ["mimeType", "mime_type", "content_type"], "attachment mime type"),
  };
  if (!attachment.mimeType.toLowerCase().startsWith("image/")) {
    throw new Error("attachment must be an image");
  }
  return attachment;
}

function eventData(record: RecordValue): RecordValue {
  return record.data === undefined ? record : asRecord(record.data, "Linq event data");
}

function eventParts(data: RecordValue): readonly unknown[] {
  const direct = data.parts;
  if (Array.isArray(direct)) return direct;
  const message = data.message;
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const nested = (message as RecordValue).parts;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function nestedId(record: RecordValue, field: string): string | undefined {
  const value = record[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return optionalString(value as RecordValue, ["id"]);
}

function normalizeParts(parts: readonly unknown[]): {
  readonly text?: string;
  readonly attachments: readonly LinqAttachment[];
} {
  const texts: string[] = [];
  const attachments: LinqAttachment[] = [];
  for (const value of parts) {
    const part = asRecord(value, "Linq message part");
    if (part.type === "text" && typeof part.value === "string" && part.value.trim() !== "") {
      texts.push(part.value.trim());
    } else if (part.type === "media") {
      attachments.push(parseAttachment(part));
    }
  }
  const text = texts.length === 0 ? undefined : texts.join("\n");
  return text === undefined ? { attachments } : { text, attachments };
}

export function normalizeLinqEvent(value: unknown, allowlistedSender: string): NormalizedLinqEvent {
  const record = asRecord(value, "Linq event");
  const data = eventData(record);
  const senderId =
    optionalString(record, ["senderId", "sender_id"]) ??
    optionalHandle(data, ["sender_handle", "from_handle"]) ??
    optionalString(data, ["from"]);
  if (senderId === undefined) throw new Error("sender is missing");
  if (senderId !== allowlistedSender) throw new Error("sender is not allowed");
  const eventId = stringField(record, ["eventId", "event_id", "id"], "event id");
  const chatId = optionalString(data, ["chat_id"]) ?? nestedId(data, "chat");
  const messageId = optionalString(data, ["message_id", "id"]) ?? nestedId(data, "message");
  const rawAttachments = record.attachments;
  if (rawAttachments !== undefined && !Array.isArray(rawAttachments)) {
    throw new Error("attachments must be an array");
  }
  const legacyText = optionalString(record, ["text"]);
  const parsedParts = normalizeParts(eventParts(data));
  const text = legacyText ?? parsedParts.text;
  const attachments = rawAttachments === undefined
    ? parsedParts.attachments
    : (rawAttachments as readonly unknown[]).map(parseAttachment);
  const routing = {
    ...(chatId === undefined ? {} : { chatId }),
    ...(messageId === undefined ? {} : { messageId }),
  };
  return text === undefined
    ? { eventId, senderId, ...routing, attachments }
    : { eventId, senderId, ...routing, text, attachments };
}

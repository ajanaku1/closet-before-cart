import { randomUUID } from "node:crypto";
import {
  normalizeLinqEvent,
  verifyLinqWebhookSignature,
  type NormalizedLinqEvent,
} from "../../../../src/adapters/linq.ts";

export interface LinqWebhookOptions {
  readonly secret: string;
  readonly allowlistedSender: string;
  readonly accept: (event: NormalizedLinqEvent) => Promise<"NEW" | "DUPLICATE">;
}

function safeError(code: string, requestId: string, status: number): Response {
  return Response.json(
    { error: { code, message: "The requested operation could not be completed.", requestId } },
    { status },
  );
}

async function readBody(request: Request): Promise<Uint8Array> {
  return new Uint8Array(await request.arrayBuffer());
}

async function parseEvent(
  request: Request,
  options: LinqWebhookOptions,
  requestId: string,
): Promise<NormalizedLinqEvent | Response> {
  let body: Uint8Array;
  try {
    body = await readBody(request);
  } catch {
    return safeError("INVALID_EVENT", requestId, 400);
  }
  if (!verifyLinqWebhookSignature(body, request.headers, options.secret)) {
    return safeError("INVALID_SIGNATURE", requestId, 401);
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(body)) as unknown;
    return normalizeLinqEvent(payload, options.allowlistedSender);
  } catch {
    return safeError("INVALID_EVENT", requestId, 400);
  }
}

async function acceptEvent(
  event: NormalizedLinqEvent,
  options: LinqWebhookOptions,
  requestId: string,
): Promise<"NEW" | "DUPLICATE" | Response> {
  try {
    return await options.accept(event);
  } catch {
    return safeError("IDEMPOTENCY_UNAVAILABLE", requestId, 503);
  }
}

export function createLinqWebhookHandler(
  options: LinqWebhookOptions,
): (request: Request) => Promise<Response> {
  return async function handleLinqWebhook(request: Request): Promise<Response> {
    const requestId = randomUUID();
    const parsed = await parseEvent(request, options, requestId);
    if (parsed instanceof Response) return parsed;
    const acceptance = await acceptEvent(parsed, options, requestId);
    if (acceptance instanceof Response) return acceptance;
    if (acceptance === "DUPLICATE") {
      return Response.json({ accepted: true, duplicate: true, eventId: parsed.eventId, requestId }, { status: 200 });
    }
    return Response.json({ accepted: true, eventId: parsed.eventId, requestId }, { status: 202 });
  };
}

export async function POST(_request: Request): Promise<Response> {
  const requestId = randomUUID();
  const secret = process.env.LINQ_WEBHOOK_SECRET;
  const allowlistedSender = process.env.LINQ_SENDER_ID;
  if (!secret || !allowlistedSender) return safeError("LINQ_NOT_CONFIGURED", requestId, 503);
  return safeError("LINQ_PROCESSOR_NOT_CONFIGURED", requestId, 503);
}

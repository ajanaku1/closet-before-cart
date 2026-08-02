import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { Inngest } from "inngest";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, payload, status, headers = {}) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(payload));
}

function error(response, code, status) {
  return sendJson(response, {
    error: { code, message: "The webhook could not be accepted." },
  }, status);
}

function headerValue(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

function signingKey(secret) {
  const encoded = secret.replace(/^whsec_/, "");
  if (encoded === "") return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 0 ? null : key;
}

function signatureMatches(body, headers, secret, nowSeconds) {
  const eventId = headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "webhook-timestamp");
  const signature = headerValue(headers, "webhook-signature");
  const signedAt = Number(timestamp);
  const key = signingKey(secret);
  if (!eventId || !timestamp || !signature || !key) return false;
  if (!Number.isFinite(nowSeconds) || !Number.isInteger(signedAt)) return false;
  if (Math.abs(nowSeconds - signedAt) > 300) return false;
  const expected = createHmac("sha256", key)
    .update(`${eventId}.${timestamp}.`)
    .update(body)
    .digest();
  return signature.split(" ").some((candidate) => matchesDigest(candidate, expected));
}

function matchesDigest(candidate, expected) {
  if (!candidate.startsWith("v1,")) return false;
  const actual = Buffer.from(candidate.slice(3), "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseEvent(body, expectedEventId, allowlistedSender) {
  const payload = JSON.parse(body.toString("utf8"));
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("invalid payload");
  }
  if (payload.event_type !== "message.received" || payload.event_id !== expectedEventId) {
    throw new Error("invalid event");
  }
  const data = payload.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("invalid data");
  }
  const sender = data.sender_handle?.handle ?? data.from ?? payload.sender_id;
  if (sender !== allowlistedSender) throw new Error("invalid sender");
  return { eventId: payload.event_id, payload };
}

export function createEventClaimer(query) {
  return async function claimEvent({ eventId, payloadDigest }) {
    const rows = await query(
      `insert into processed_webhooks
        (source, external_id, payload_digest, safe_result_code)
       values ('LINQ', $1, $2, 'RECEIVED')
       on conflict (source, external_id) do nothing
       returning external_id`,
      [eventId, payloadDigest],
    );
    return rows.length === 0 ? "DUPLICATE" : "NEW";
  };
}

async function claimParsedEvent(response, event, body, claim, dispatch) {
  const payloadDigest = createHash("sha256").update(body).digest("hex");
  let result;
  try {
    result = await claim({ eventId: event.eventId, payloadDigest });
  } catch {
    return error(response, "IDEMPOTENCY_UNAVAILABLE", 503);
  }
  try {
    await dispatch(event.payload);
  } catch {
    return error(response, "WORKFLOW_UNAVAILABLE", 503);
  }
  const payload = result === "DUPLICATE"
    ? { accepted: true, duplicate: true, eventId: event.eventId }
    : { accepted: true, eventId: event.eventId };
  return sendJson(response, payload, result === "DUPLICATE" ? 200 : 202);
}

async function handlePost(request, response, options) {
  if (!options.secret || !options.allowlistedSender || !options.claim || !options.dispatch) {
    return error(response, "LINQ_PROCESSOR_NOT_CONFIGURED", 503);
  }
  let body;
  try {
    body = await readBody(request);
  } catch {
    return error(response, "INVALID_EVENT", 400);
  }
  const nowSeconds = options.nowSeconds();
  if (!signatureMatches(body, request.headers, options.secret, nowSeconds)) {
    return error(response, "INVALID_SIGNATURE", 401);
  }
  try {
    const eventId = headerValue(request.headers, "webhook-id");
    const event = parseEvent(body, eventId, options.allowlistedSender);
    return claimParsedEvent(response, event, body, options.claim, options.dispatch);
  } catch {
    return error(response, "INVALID_EVENT", 400);
  }
}

export function createLinqHandler(configuration = {}) {
  const options = {
    secret: configuration.secret,
    allowlistedSender: configuration.allowlistedSender,
    claim: configuration.claim,
    dispatch: configuration.dispatch,
    nowSeconds: configuration.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
  };
  return async function handler(request, response) {
    if (request.method === "GET") {
      return sendJson(response, {
        service: "cbc-linq-webhook",
        status: "ready_for_subscription",
      }, 200);
    }
    if (request.method === "POST") return handlePost(request, response, options);
    return sendJson(response, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
      allow: "GET, POST",
    });
  };
}

const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
const sql = connectionString ? neon(connectionString) : undefined;
const inngest = new Inngest({ id: "closet-before-cart" });

export default createLinqHandler({
  secret: process.env.LINQ_WEBHOOK_SECRET,
  allowlistedSender: process.env.LINQ_SENDER_ID,
  claim: sql ? createEventClaimer((text, parameters) => sql.query(text, parameters)) : undefined,
  dispatch: (payload) => inngest.send({
    id: payload.event_id,
    name: "cbc/linq.message.received",
    data: { payload },
  }),
});

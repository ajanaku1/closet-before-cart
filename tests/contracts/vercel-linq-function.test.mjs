import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import handler, * as linqFunction from "../../api/webhooks/linq.mjs";

const signingKey = Buffer.from("vercel-linq-fixture-secret");
const secret = `whsec_${signingKey.toString("base64")}`;
const timestamp = 1_760_000_000;

function responseRecorder() {
  return {
    statusCode: 200,
    body: "",
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), String(value));
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}

async function invokeHandler(activeHandler, request) {
  const response = responseRecorder();
  await activeHandler(request, response);
  return response;
}

function invoke(method) {
  return invokeHandler(handler, { method });
}

function signedRequest(sender = "sender-1", signatureOverride) {
  const payload = {
    event_type: "message.received",
    event_id: "event-1",
    data: {
      sender_handle: { handle: sender },
      parts: [{ type: "text", value: "wedding" }],
    },
  };
  const body = Buffer.from(JSON.stringify(payload));
  const signature = signatureOverride ?? createHmac("sha256", signingKey)
    .update(`event-1.${timestamp}.`)
    .update(body)
    .digest("base64");
  const request = Readable.from([body]);
  request.method = "POST";
  request.headers = {
    "webhook-id": "event-1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  };
  return request;
}

function configuredHandler(overrides = {}) {
  return linqFunction.createLinqHandler({
    secret,
    allowlistedSender: "sender-1",
    nowSeconds: () => timestamp + 30,
    claim: async () => "NEW",
    dispatch: async () => undefined,
    ...overrides,
  });
}

test("exports a configurable Linq intake handler", () => {
  assert.equal(typeof linqFunction.createLinqHandler, "function");
});

test("claims Linq events atomically in the processed webhook ledger", async () => {
  const queries = [];
  const claim = linqFunction.createEventClaimer(async (text, parameters) => {
    queries.push({ text, parameters });
    return [{ external_id: "event-1" }];
  });

  const result = await claim({ eventId: "event-1", payloadDigest: "a".repeat(64) });

  assert.equal(result, "NEW");
  assert.match(queries[0].text, /insert into processed_webhooks/i);
  assert.match(queries[0].text, /on conflict \(source, external_id\) do nothing/i);
  assert.deepEqual(queries[0].parameters, ["event-1", "a".repeat(64)]);
});

test("maps an existing webhook claim to a duplicate", async () => {
  const claim = linqFunction.createEventClaimer(async () => []);

  assert.equal(
    await claim({ eventId: "event-1", payloadDigest: "a".repeat(64) }),
    "DUPLICATE",
  );
});

test("exposes a public readiness response for Linq subscription setup", async () => {
  const response = await invoke("GET");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    service: "cbc-linq-webhook",
    status: "ready_for_subscription",
  });
});

test("allows only GET and POST on the deployed Linq endpoint", async () => {
  const response = await invoke("PUT");

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
});

test("keeps webhook delivery closed until the processor is configured", async () => {
  const response = await invoke("POST");

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, "LINQ_PROCESSOR_NOT_CONFIGURED");
});

test("accepts a valid signed event from the allowlisted sender", async () => {
  const claims = [];
  const dispatched = [];
  const activeHandler = configuredHandler({
    claim: async (claim) => {
      claims.push(claim);
      return "NEW";
    },
    dispatch: async (event) => dispatched.push(event),
  });

  const response = await invokeHandler(activeHandler, signedRequest());

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    accepted: true,
    eventId: "event-1",
  });
  assert.equal(claims.length, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].event_id, "event-1");
  assert.equal(claims[0].eventId, "event-1");
  assert.match(claims[0].payloadDigest, /^[a-f0-9]{64}$/);
});

test("re-dispatches a duplicate with the same provider event id for safe recovery", async () => {
  let dispatches = 0;
  const activeHandler = configuredHandler({
    claim: async () => "DUPLICATE",
    dispatch: async () => { dispatches += 1; },
  });

  await invokeHandler(activeHandler, signedRequest());

  assert.equal(dispatches, 1);
});

test("returns the recorded result for a duplicate Linq event", async () => {
  const activeHandler = configuredHandler({ claim: async () => "DUPLICATE" });

  const response = await invokeHandler(activeHandler, signedRequest());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    accepted: true,
    duplicate: true,
    eventId: "event-1",
  });
});

test("fails closed when the durable idempotency claim is unavailable", async () => {
  const activeHandler = configuredHandler({
    claim: async () => {
      throw new Error("database unavailable");
    },
  });

  const response = await invokeHandler(activeHandler, signedRequest());

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error.code, "IDEMPOTENCY_UNAVAILABLE");
});

test("rejects an event with an invalid signature", async () => {
  const response = await invokeHandler(configuredHandler(), signedRequest("sender-1", "bad"));

  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error.code, "INVALID_SIGNATURE");
});

test("rejects an event from a sender outside the allowlist", async () => {
  const response = await invokeHandler(configuredHandler(), signedRequest("other-sender"));

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.code, "INVALID_EVENT");
});

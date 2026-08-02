import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinqWebhookHandler,
  type LinqWebhookOptions,
} from "../../app/api/webhooks/linq/route.ts";

const signingKey = Buffer.from("route-fixture-secret");
const secret = `whsec_${signingKey.toString("base64")}`;
const timestamp = Math.floor(Date.now() / 1000);
const eventBody = JSON.stringify({
  event_id: "event-1",
  sender_id: "sender-1",
  text: "wedding",
  attachments: [],
});

function signedRequest(body: string = eventBody): Request {
  const signature = createHmac("sha256", signingKey)
    .update(`event-1.${timestamp}.${body}`)
    .digest("base64");
  return new Request("https://cbc.example.invalid/api/webhooks/linq", {
    method: "POST",
    body,
    headers: {
      "webhook-id": "event-1",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    },
  });
}

function options(overrides: Partial<LinqWebhookOptions> = {}): LinqWebhookOptions {
  return {
    secret,
    allowlistedSender: "sender-1",
    accept: async () => "NEW",
    ...overrides,
  };
}

test("acknowledges only after claiming and processing a valid Linq event", async () => {
  const calls: string[] = [];
  const handler = createLinqWebhookHandler(
    options({
      accept: async (event) => {
        calls.push(`claim:${event.eventId}`);
        calls.push(`process:${event.eventId}`);
        return "NEW";
      },
    }),
  );

  const response = await handler(signedRequest());

  assert.equal(response.status, 202);
  assert.deepEqual(calls, ["claim:event-1", "process:event-1"]);
});

test("returns a recorded result for duplicate events and does not process twice", async () => {
  let processed = 0;
  const handler = createLinqWebhookHandler(
    options({
      accept: async () => {
        return "DUPLICATE";
      },
    }),
  );

  const response = await handler(signedRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(processed, 0);
});

test("fails closed for invalid signatures and does not claim the event", async () => {
  let claimed = 0;
  const handler = createLinqWebhookHandler(
    options({ accept: async () => { claimed += 1; return "NEW"; } }),
  );
  const request = new Request("https://cbc.example.invalid/api/webhooks/linq", {
    method: "POST",
    body: eventBody,
    headers: {
      "webhook-id": "event-1",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": "v1,bad",
    },
  });

  const response = await handler(request);

  assert.equal(response.status, 401);
  assert.equal(claimed, 0);
});

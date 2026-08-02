import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLinqEvent,
  verifyLinqWebhookSignature,
} from "../../src/adapters/linq.ts";

const signingKey = Buffer.from("linq-fixture-secret");
const secret = `whsec_${signingKey.toString("base64")}`;
const eventId = "event-1";
const timestamp = 1_760_000_000;

function signedHeaders(body: Uint8Array, signedAt: number = timestamp): Headers {
  const signature = createHmac("sha256", signingKey)
    .update(`${eventId}.${signedAt}.`)
    .update(body)
    .digest("base64");
  return new Headers({
    "webhook-id": eventId,
    "webhook-timestamp": String(signedAt),
    "webhook-signature": `v1,${signature}`,
  });
}

test("verifies Linq Standard Webhooks signatures and rejects altered bytes", () => {
  const body = new TextEncoder().encode('{"id":"event-1"}');
  const altered = new TextEncoder().encode('{"id":"event-2"}');

  assert.equal(verifyLinqWebhookSignature(body, signedHeaders(body), secret, timestamp + 30), true);
  assert.equal(verifyLinqWebhookSignature(altered, signedHeaders(body), secret, timestamp + 30), false);
  assert.equal(verifyLinqWebhookSignature(body, new Headers(), secret, timestamp + 30), false);
});

test("rejects a Linq webhook outside the five-minute replay window", () => {
  const body = new TextEncoder().encode('{"id":"event-1"}');

  assert.equal(verifyLinqWebhookSignature(body, signedHeaders(body), secret, timestamp + 301), false);
});

test("normalizes one allowlisted sender and direct image attachments", () => {
  const event = normalizeLinqEvent(
    {
      event_id: "event-1",
      sender_id: "sender-1",
      text: "Friday wedding, no black",
      attachments: [{ id: "photo-1", url: "https://example.invalid/photo", mime_type: "image/jpeg" }],
    },
    "sender-1",
  );

  assert.deepEqual(event, {
    eventId: "event-1",
    senderId: "sender-1",
    text: "Friday wedding, no black",
    attachments: [{ id: "photo-1", url: "https://example.invalid/photo", mimeType: "image/jpeg" }],
  });
});

test("normalizes Linq's documented message.received envelope", () => {
  const event = normalizeLinqEvent(
    {
      api_version: "v3",
      event_type: "message.received",
      event_id: "event-envelope-1",
      data: {
        id: "message-envelope-1",
        chat: { id: "chat-envelope-1" },
        sender_handle: { handle: "sender-1", is_me: false },
        parts: [
          { type: "text", value: "Here is the outfit" },
          {
            type: "media",
            id: "photo-envelope-1",
            url: "https://cdn.linqapp.com/photo",
            mime_type: "image/jpeg",
          },
        ],
      },
    },
    "sender-1",
  );

  assert.deepEqual(event, {
    eventId: "event-envelope-1",
    senderId: "sender-1",
    chatId: "chat-envelope-1",
    messageId: "message-envelope-1",
    text: "Here is the outfit",
    attachments: [
      {
        id: "photo-envelope-1",
        url: "https://cdn.linqapp.com/photo",
        mimeType: "image/jpeg",
      },
    ],
  });
});

test("rejects an unsupported sender before exposing event data", () => {
  assert.throws(
    () => normalizeLinqEvent({ event_id: "event-1", sender_id: "other" }, "sender-1"),
    /sender is not allowed/i,
  );
});

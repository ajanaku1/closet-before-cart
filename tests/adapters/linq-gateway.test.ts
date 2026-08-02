import assert from "node:assert/strict";
import test from "node:test";
import { createLinqGateway } from "../../src/adapters/linq-gateway.ts";

test("sends a retry-safe text and media reply to the existing Linq chat", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createLinqGateway({
    apiKey: "fixture-key",
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ id: "message-1" });
    },
  });

  const result = await gateway.sendReply("chat-1", {
    text: "Your outfit is ready.",
    imageUrl: "https://cbc.example/preview.png",
    idempotencyKey: "event-1-result",
  });
  const body = JSON.parse(String(requests[0]?.init?.body));

  assert.equal(requests[0]?.url, "https://api.linqapp.com/api/partner/v3/chats/chat-1/messages");
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer fixture-key");
  assert.deepEqual(body.message.parts, [
    { type: "text", value: "Your outfit is ready." },
    { type: "media", url: "https://cbc.example/preview.png" },
  ]);
  assert.equal(body.message.idempotency_key, "event-1-result");
  assert.equal(result.messageId, "message-1");
});

test("reads the message id from Linq's documented send response", async () => {
  const gateway = createLinqGateway({
    apiKey: "fixture-key",
    fetch: async () => Response.json({
      chat_id: "chat-1",
      message: { id: "message-2", delivery_status: "queued" },
    }),
  });

  const result = await gateway.sendReply("chat-1", {
    text: "Your result is ready.",
    idempotencyKey: "event-2-result",
  });

  assert.equal(result.messageId, "message-2");
});

test("rejects an empty reply before calling Linq", async () => {
  let calls = 0;
  const gateway = createLinqGateway({
    apiKey: "fixture-key",
    fetch: async () => { calls += 1; return Response.json({}); },
  });

  await assert.rejects(gateway.sendReply("chat-1", { idempotencyKey: "event-1" }), /reply content/i);
  assert.equal(calls, 0);
});

test("starts and stops Linq's V3 typing indicator for the existing chat", async () => {
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  const gateway = createLinqGateway({
    apiKey: "linq_test_key",
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(null, { status: 204 });
    },
  });

  await gateway.startTyping("chat-1");
  await gateway.stopTyping("chat-1");

  assert.deepEqual(requests, [
    {
      url: "https://api.linqapp.com/api/partner/v3/chats/chat-1/typing",
      method: "POST",
      authorization: "Bearer linq_test_key",
    },
    {
      url: "https://api.linqapp.com/api/partner/v3/chats/chat-1/typing",
      method: "DELETE",
      authorization: "Bearer linq_test_key",
    },
  ]);
});

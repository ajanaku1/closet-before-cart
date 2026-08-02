import assert from "node:assert/strict";
import test from "node:test";
import { processShoppingReply } from "../../src/workflow/process-shopping.ts";
import type { StyleProof } from "../../src/contracts/domain.ts";
import type { StyleConstraints } from "../../src/domain/style-gap.ts";

const proof: StyleProof = {
  proofId: "44444444-4444-4444-8444-444444444444",
  caseId: "33333333-3333-4333-8333-333333333333",
  garmentDigest: "garments",
  constraintDigest: "constraints",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND",
  missingCategory: "SHOES",
  issuedAt: "2026-08-02T12:00:00Z",
  expiresAt: "2026-08-02T12:15:00Z",
  signature: "signature",
};

const constraints: StyleConstraints = {
  occasion: "Friday wedding",
  requiredCategories: ["TOP", "BOTTOM", "SHOES"],
  excludedColors: ["BLACK"],
  maxNewItems: 1,
  referencePhotoPresent: true,
};

test("stores a partial answer and asks only for details still missing", async () => {
  const saved: StyleConstraints[] = [];
  const replies: string[] = [];
  let approvals = 0;

  const result = await processShoppingReply(
    {
      eventId: "reply-1",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Men's, size 10",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async (_caseId, value) => { saved.push(value); },
      startApproval: async () => {
        approvals += 1;
        return { approvalId: "must-not-run", approvalUrl: "https://example.com" };
      },
      reply: async (_chatId, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result?.decision, "GAP_FOUND");
  assert.equal(approvals, 0);
  assert.equal(saved[0]?.shoppingDepartment, "MEN");
  assert.equal(saved[0]?.shoppingSize, "10");
  assert.match(replies[0] ?? "", /maximum budget/i);
  assert.doesNotMatch(replies[0] ?? "", /shoe size/i);
});

test("resumes Everlane approval after a complete text-only answer", async () => {
  const calls: string[] = [];
  const result = await processShoppingReply(
    {
      eventId: "reply-2",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Women's, US shoe size 8, max $200",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async (_caseId, value) => {
        calls.push(`save:${value.shoppingDepartment}:${value.shoppingSize}:${value.maxPriceMinor}`);
      },
      startApproval: async (_proof, category, senderId, value) => {
        calls.push(`approve:${category}:${senderId}:${value.maxPriceMinor}`);
        return { approvalId: "sess-1", approvalUrl: "https://sandbox.collect.prava.space/s/1" };
      },
      reply: async (_chatId, message) => { calls.push(`reply:${message.text}`); },
    },
  );

  assert.deepEqual(result, {
    caseId: proof.caseId,
    decision: "GAP_FOUND",
    approvalId: "sess-1",
  });
  assert.deepEqual(calls, [
    "save:WOMEN:8:20000",
    "approve:SHOES:sender-1:20000",
    "reply:One wardrobe gap remains. Open this fresh Prava sandbox approval in a normal Safari or Chrome window on a device with biometrics enabled: https://sandbox.collect.prava.space/s/1",
  ]);
});

test("does not claim an ordinary message when no pending gap exists", async () => {
  const result = await processShoppingReply(
    { eventId: "reply-3", senderId: "sender-1", chatId: "chat-1", text: "hello", attachments: [] },
    {
      loadPending: async () => null,
      saveConstraints: async () => { throw new Error("must not save"); },
      startApproval: async () => { throw new Error("must not approve"); },
      reply: async () => { throw new Error("must not reply"); },
    },
  );

  assert.equal(result, undefined);
});

test("asks for a clear correction when a reply contains conflicting details", async () => {
  const replies: string[] = [];
  let saves = 0;
  let approvals = 0;

  const result = await processShoppingReply(
    {
      eventId: "reply-4",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Men's and women's, size 8, max $200",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async () => { saves += 1; },
      startApproval: async () => {
        approvals += 1;
        return { approvalId: "must-not-run", approvalUrl: "https://example.com" };
      },
      reply: async (_chatId, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result?.decision, "GAP_FOUND");
  assert.equal(saves, 0);
  assert.equal(approvals, 0);
  assert.match(replies[0] ?? "", /couldn't safely read/i);
  assert.match(replies[0] ?? "", /men's or women's/i);
});

test("explains the valid US shoe-size range", async () => {
  const replies: string[] = [];
  let saves = 0;

  await processShoppingReply(
    {
      eventId: "reply-size",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Men's, size 44, max $70",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async () => { saves += 1; },
      startApproval: async () => ({ approvalId: "must-not-run", approvalUrl: "https://example.com" }),
      reply: async (_chatId, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(saves, 0);
  assert.match(replies[0] ?? "", /US shoe size from 4 to 18/i);
});

test("keeps the merchant name out of a checkout failure reply", async () => {
  const replies: string[] = [];

  await processShoppingReply(
    {
      eventId: "reply-5",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Women's, US shoe size 8, max $200",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async () => undefined,
      startApproval: async () => ({
        errorCode: "CHECKOUT_FAILED",
        errorMessage: "The selected item could not be reserved",
      }),
      reply: async (_chatId, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.match(replies[0] ?? "", /checkout could not start/i);
  assert.doesNotMatch(replies[0] ?? "", /Everlane/i);
});

test("turns an exact-match miss into a request to revise shopping details", async () => {
  const replies: string[] = [];

  await processShoppingReply(
    {
      eventId: "reply-6",
      senderId: "sender-1",
      chatId: "chat-1",
      text: "Men's, US shoe size 10, max $70",
      attachments: [],
    },
    {
      loadPending: async () => ({ proof, constraints }),
      saveConstraints: async () => undefined,
      startApproval: async () => ({
        errorCode: "NO_EXACT_OPTION",
        errorMessage: "No exact available option matched your details.",
      }),
      reply: async (_chatId, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.match(replies[0] ?? "", /No exact available option/i);
  assert.match(replies[0] ?? "", /revise.*US shoe size.*maximum budget/i);
  assert.match(replies[0] ?? "", /No checkout was started/i);
  assert.doesNotMatch(replies[0] ?? "", /could not start/i);
});

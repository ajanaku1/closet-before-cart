import assert from "node:assert/strict";
import test from "node:test";
import { processWardrobeMessage } from "../../src/workflow/process-case.ts";
import type { StyleProof } from "../../src/contracts/domain.ts";

const proof: StyleProof = {
  proofId: "proof-1",
  caseId: "case-1",
  garmentDigest: "garments",
  constraintDigest: "constraints",
  ruleVersion: "style-rules-v1",
  decision: "GAP_FOUND",
  missingCategory: "SHOES",
  issuedAt: "2026-08-02T12:00:00Z",
  expiresAt: "2026-08-02T12:15:00Z",
  signature: "signature",
};

test("persists a gap proof, starts sandbox approval, and replies in the inbound chat", async () => {
  const calls: string[] = [];
  const result = await processWardrobeMessage(
    {
      eventId: "event-1",
      senderId: "sender-test",
      chatId: "chat-1",
      attachments: [],
    },
    {
      prepare: async () => ({
        referencePhoto: { attachmentId: "reference", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
        wardrobePhotos: [],
        constraints: {
          occasion: "wedding",
          requiredCategories: ["TOP", "BOTTOM", "SHOES"],
          excludedColors: [],
          maxNewItems: 1,
          referencePhotoPresent: true,
          shoppingDepartment: "MEN",
          shoppingSize: "10",
          maxPriceMinor: 20_000,
        },
      }),
      run: async () => ({
        result: {
          decision: "GAP_FOUND",
          paymentAllowed: true,
          rule: "MISSING_CATEGORY",
          missingCategories: ["SHOES"],
          usedGarmentIds: ["top-1", "bottom-1"],
        },
        previewUrl: "data:image/png;base64,aW1hZ2U=",
        proof,
        rawMediaDeleted: true,
      }),
      persist: async (_event, _outcome, constraints) => {
        assert.equal(constraints.shoppingSize, "10");
        calls.push("persist");
        return {
          previewUrl: "https://cbc.example/api/preview?case=case-1",
          proofUrl: "https://cbc.example/api/proof?id=proof-1",
        };
      },
      startApproval: async (_proof, _category, senderId, constraints) => {
        assert.equal(senderId, "sender-test");
        assert.equal(constraints.maxPriceMinor, 20_000);
        calls.push("approval");
        return { approvalId: "sess-1", approvalUrl: "https://sandbox.collect.prava.space/s/1" };
      },
      reply: async (_chatId, message) => {
        calls.push(`reply:${message.idempotencyKey}`);
        assert.match(message.text ?? "", /sandbox approval/i);
        assert.equal(message.imageUrl, "https://cbc.example/api/preview?case=case-1");
      },
    },
  );

  assert.deepEqual(calls, ["persist", "approval", "reply:event-1-result"]);
  assert.deepEqual(result, {
    caseId: "event-1",
    decision: "GAP_FOUND",
    approvalId: "sess-1",
  });
});

test("asks for missing shopping details before calling Everlane or Prava", async () => {
  const replies: string[] = [];
  let approvals = 0;

  const result = await processWardrobeMessage(
    { eventId: "event-details", senderId: "sender", chatId: "chat-details", attachments: [] },
    {
      prepare: async () => ({
        referencePhoto: { attachmentId: "reference", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
        wardrobePhotos: [],
        constraints: {
          occasion: "Friday wedding",
          requiredCategories: ["TOP", "BOTTOM", "SHOES"],
          excludedColors: ["BLACK"],
          maxNewItems: 1,
          referencePhotoPresent: true,
        },
      }),
      run: async () => ({
        result: {
          decision: "GAP_FOUND",
          paymentAllowed: true,
          rule: "MISSING_CATEGORY",
          missingCategories: ["SHOES"],
          usedGarmentIds: ["top-1", "bottom-1"],
        },
        previewUrl: "data:image/png;base64,aW1hZ2U=",
        proof,
        rawMediaDeleted: true,
      }),
      persist: async () => ({
        previewUrl: "https://cbc.example/api/preview?case=case-1",
        proofUrl: "https://cbc.example/api/proof?id=proof-1",
      }),
      startApproval: async () => {
        approvals += 1;
        return { approvalId: "must-not-run", approvalUrl: "https://example.com" };
      },
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.approvalId, undefined);
  assert.equal(approvals, 0);
  assert.match(replies[0] ?? "", /missing item: shoes suitable for your Friday wedding/i);
  assert.match(replies[0] ?? "", /other required categories/i);
  assert.match(replies[0] ?? "", /no eligible shoes/i);
  assert.match(replies[0] ?? "", /men's or women's/i);
  assert.match(replies[0] ?? "", /US shoe size/i);
  assert.match(replies[0] ?? "", /maximum budget/i);
});

test("asks for evidence without rendering, persisting, or opening payment", async () => {
  const replies: string[] = [];
  const result = await processWardrobeMessage(
    { eventId: "event-2", senderId: "sender", chatId: "chat-2", attachments: [] },
    {
      prepare: async () => ({
        referencePhoto: { attachmentId: "reference", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
        wardrobePhotos: [],
        constraints: {
          occasion: "wedding",
          requiredCategories: ["TOP", "BOTTOM", "SHOES"],
          excludedColors: [],
          maxNewItems: 1,
          referencePhotoPresent: true,
          shoppingDepartment: "MEN",
          shoppingSize: "10",
          maxPriceMinor: 20_000,
        },
      }),
      run: async () => ({
        result: {
          decision: "MORE_EVIDENCE",
          paymentAllowed: false,
          rule: "MISSING_GARMENT_EVIDENCE",
          missingCategories: [],
          usedGarmentIds: [],
        },
        rawMediaDeleted: true,
      }),
      persist: async () => { throw new Error("must not persist"); },
      startApproval: async () => { throw new Error("must not approve"); },
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.match(replies[0] ?? "", /clearer photo/i);
});

test("replies with an actionable brief when intake constraints are missing", async () => {
  const replies: string[] = [];
  const result = await processWardrobeMessage(
    { eventId: "event-3", senderId: "sender", chatId: "chat-3", attachments: [] },
    {
      prepare: async () => {
        throw new Error("A supported occasion and one-item limit are required");
      },
      run: async () => { throw new Error("must not run"); },
      persist: async () => { throw new Error("must not persist"); },
      startApproval: async () => { throw new Error("must not approve"); },
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.match(replies[0] ?? "", /Friday wedding, no black, one new item maximum/);
});

test("replies with the required image count when intake is incomplete", async () => {
  const replies: string[] = [];
  const result = await processWardrobeMessage(
    { eventId: "event-4", senderId: "sender", chatId: "chat-4", attachments: [] },
    {
      prepare: async () => { throw new Error("Seven image attachments are required"); },
      run: async () => { throw new Error("must not run"); },
      persist: async () => { throw new Error("must not persist"); },
      startApproval: async () => { throw new Error("must not approve"); },
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.match(replies[0] ?? "", /exactly seven images/i);
});

test("keeps retryable intake failures visible to Inngest", async () => {
  await assert.rejects(
    processWardrobeMessage(
      { eventId: "event-5", senderId: "sender", chatId: "chat-5", attachments: [] },
      {
        prepare: async () => { throw new Error("temporary media provider outage"); },
        run: async () => { throw new Error("must not run"); },
        persist: async () => { throw new Error("must not persist"); },
        startApproval: async () => { throw new Error("must not approve"); },
        reply: async () => { throw new Error("must not reply"); },
      },
    ),
    /temporary media provider outage/,
  );
});

test("replies with supported formats when an attachment cannot be accepted", async () => {
  const replies: string[] = [];
  const result = await processWardrobeMessage(
    { eventId: "event-6", senderId: "sender", chatId: "chat-6", attachments: [] },
    {
      prepare: async () => { throw new Error("Unsupported image format"); },
      run: async () => { throw new Error("must not run"); },
      persist: async () => { throw new Error("must not persist"); },
      startApproval: async () => { throw new Error("must not approve"); },
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.decision, "MORE_EVIDENCE");
  assert.match(replies[0] ?? "", /JPEG, PNG, or WebP/i);
});

test("surfaces a Prava failure once without throwing for Inngest to retry", async () => {
  const replies: string[] = [];
  const result = await processWardrobeMessage(
    {
      eventId: "event-7",
      senderId: "sender-test",
      chatId: "chat-7",
      attachments: [],
    },
    {
      prepare: async () => ({
        referencePhoto: { attachmentId: "reference", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
        wardrobePhotos: [],
        constraints: {
          occasion: "wedding",
          requiredCategories: ["TOP", "BOTTOM", "SHOES"],
          excludedColors: [],
          maxNewItems: 1,
          referencePhotoPresent: true,
          shoppingDepartment: "MEN",
          shoppingSize: "10",
          maxPriceMinor: 20_000,
        },
      }),
      run: async () => ({
        result: {
          decision: "GAP_FOUND",
          paymentAllowed: true,
          rule: "MISSING_CATEGORY",
          missingCategories: ["SHOES"],
          usedGarmentIds: ["top-1", "bottom-1"],
        },
        previewUrl: "data:image/png;base64,aW1hZ2U=",
        proof,
        rawMediaDeleted: true,
      }),
      persist: async () => ({
        previewUrl: "https://cbc.example/api/preview?case=case-1",
        proofUrl: "https://cbc.example/api/proof?id=proof-1",
      }),
      startApproval: async () => ({
        errorCode: "PASSKEY_REG_FAILED",
        errorMessage: "Passkey registration failed",
      }),
      reply: async (_chat, message) => { replies.push(message.text ?? ""); },
    },
  );

  assert.equal(result.decision, "GAP_FOUND");
  assert.equal(result.approvalId, undefined);
  assert.match(replies[0] ?? "", /PASSKEY_REG_FAILED/);
  assert.match(replies[0] ?? "", /Passkey registration failed/);
  assert.doesNotMatch(replies[0] ?? "", /Everlane/i);
});

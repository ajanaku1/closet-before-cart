import assert from "node:assert/strict";
import test from "node:test";
import { createCaseStore } from "../../src/adapters/case-store.ts";
import type { StyleProof } from "../../src/contracts/domain.ts";

const proof: StyleProof = {
  proofId: "44444444-4444-4444-8444-444444444444",
  caseId: "33333333-3333-4333-8333-333333333333",
  garmentDigest: "garments",
  constraintDigest: "constraints",
  ruleVersion: "style-rules-v1",
  decision: "STYLE_READY",
  issuedAt: "2026-08-02T12:00:00Z",
  expiresAt: "2026-08-02T12:15:00Z",
  signature: "signature",
};

test("persists only derived case output and returns public proof and preview URLs", async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async (sql, values) => { queries.push({ sql, values }); return []; },
  });

  const urls = await store.persist(
    {
      eventId: proof.caseId,
      senderId: "sender-1",
      chatId: "chat-1",
      attachments: [],
    },
    {
      result: {
        decision: "STYLE_READY",
        paymentAllowed: false,
        rule: "ALL_CONSTRAINTS_SATISFIED",
        missingCategories: [],
        usedGarmentIds: ["top-1"],
      },
      previewUrl: "data:image/png;base64,aW1hZ2U=",
      proof,
      rawMediaDeleted: true,
    },
  );

  assert.deepEqual(urls, {
    previewUrl: `https://cbc.example/api/preview?case=${proof.caseId}`,
    proofUrl: `https://cbc.example/api/proof?id=${proof.proofId}`,
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0]?.sql ?? "", /insert into style_cases/i);
  assert.match(queries[1]?.sql ?? "", /insert into style_proofs/i);
  assert.doesNotMatch(JSON.stringify(queries), /sender-1.*aW1hZ2U.*sender-1/);
});

test("loads a safe proof page model and generated preview without returning raw media", async () => {
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async (sql) => {
      if (/previewDataUrl/i.test(sql)) return [{ preview_data_url: "data:image/png;base64,aW1hZ2U=" }];
      return [{
        case_id: proof.caseId,
        decision: "STYLE_READY",
        missing_category: null,
        result: { usedGarmentIds: ["top-1", "bottom-1"] },
        amount_minor: null,
        currency: null,
        merchant: null,
        variant_id: null,
        source_mode: null,
        payment_status: null,
      }];
    },
  });

  const model = await store.findProofModel(proof.proofId);
  const preview = await store.findPreview(proof.caseId);

  assert.equal(model?.decision, "STYLE_READY");
  assert.equal(model?.previewUrl, `/api/preview?case=${proof.caseId}`);
  assert.deepEqual(model?.ownedItems, ["top-1", "bottom-1"]);
  assert.deepEqual(preview, { mimeType: "image/png", bytes: Buffer.from("image") });
});

test("stores a safe Prava failure code with the terminal payment status", async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async (sql, values) => { queries.push({ sql, values }); return []; },
  });

  await store.updateApproval("session-1", "DECLINED", "PASSKEY_REG_FAILED");

  assert.match(queries[0]?.sql ?? "", /safe_error_code\s*=\s*\$3/i);
  assert.deepEqual(queries[0]?.values, [
    "session-1",
    "DECLINED",
    "PASSKEY_REG_FAILED",
  ]);
});

test("loads the latest unapproved gap for a sender without raw media", async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async (sql, values) => {
      calls.push({ sql, values });
      return [{
        case_id: "33333333-3333-4333-8333-333333333333",
        constraints: {
          occasion: "Friday wedding",
          requiredCategories: ["TOP", "BOTTOM", "SHOES"],
          excludedColors: ["BLACK"],
          maxNewItems: 1,
          referencePhotoPresent: true,
        },
        proof_id: proof.proofId,
        garment_digest: proof.garmentDigest,
        constraint_digest: proof.constraintDigest,
        rule_version: proof.ruleVersion,
        decision: "GAP_FOUND",
        missing_category: "SHOES",
        quote_id: null,
        merchant: null,
        variant_id: null,
        amount_minor: null,
        currency: null,
        issued_at: proof.issuedAt,
        expires_at: proof.expiresAt,
        signature: proof.signature,
      }];
    },
  });

  const pending = await store.findPendingGap("sender-1");

  assert.equal(pending?.proof.proofId, proof.proofId);
  assert.equal(pending?.proof.missingCategory, "SHOES");
  assert.equal(pending?.constraints.excludedColors[0], "BLACK");
  assert.match(calls[0]?.sql ?? "", /state\s*=\s*'GAP_FOUND'/i);
  assert.match(calls[0]?.sql ?? "", /not exists/i);
  assert.notEqual(calls[0]?.values[0], "sender-1");
});

test("updates only shopping constraints on a pending case", async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async (sql, values) => { calls.push({ sql, values }); return []; },
  });

  await store.saveConstraints(proof.caseId, {
    occasion: "Friday wedding",
    requiredCategories: ["TOP", "BOTTOM", "SHOES"],
    excludedColors: ["BLACK"],
    maxNewItems: 1,
    referencePhotoPresent: true,
    shoppingDepartment: "MEN",
    shoppingSize: "10",
    maxPriceMinor: 20_000,
  });

  assert.match(calls[0]?.sql ?? "", /update style_cases/i);
  assert.deepEqual(calls[0]?.values, [proof.caseId, JSON.stringify({
    occasion: "Friday wedding",
    requiredCategories: ["TOP", "BOTTOM", "SHOES"],
    excludedColors: ["BLACK"],
    maxNewItems: 1,
    referencePhotoPresent: true,
    shoppingDepartment: "MEN",
    shoppingSize: "10",
    maxPriceMinor: 20_000,
  })]);
});

test("ignores legacy pending cases that lack resumable constraints", async () => {
  const store = createCaseStore({
    baseUrl: "https://cbc.example",
    query: async () => [{
      case_id: proof.caseId,
      constraints: {},
      proof_id: proof.proofId,
      garment_digest: proof.garmentDigest,
      constraint_digest: proof.constraintDigest,
      rule_version: proof.ruleVersion,
      decision: "GAP_FOUND",
      missing_category: "SHOES",
      issued_at: proof.issuedAt,
      expires_at: proof.expiresAt,
      signature: proof.signature,
    }],
  });

  assert.equal(await store.findPendingGap("sender-1"), null);
});

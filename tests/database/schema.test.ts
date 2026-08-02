import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/001_initial.sql", import.meta.url);

function migration(): string {
  assert.equal(existsSync(migrationUrl), true, "initial database migration must exist");
  return readFileSync(migrationUrl, "utf8");
}

test("defines the seven durable CBC tables", () => {
  const sql = migration();
  for (const table of [
    "style_cases",
    "garment_items",
    "commerce_quotes",
    "style_proofs",
    "payment_attempts",
    "processed_webhooks",
    "audit_events",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}\\b`, "i"));
  }
});

test("enforces webhook and payment idempotency in Postgres", () => {
  const sql = migration();
  assert.match(sql, /primary key\s*\(source,\s*external_id\)/i);
  assert.match(sql, /idempotency_key\s+text\s+not null\s+unique/i);
});

test("constrains domain states and immutable quote bounds", () => {
  const sql = migration();
  assert.match(sql, /state\s+text\s+not null\s+check\s*\(state in\s*\(/i);
  assert.match(sql, /prevent_commerce_quote_update/i);
  assert.match(sql, /before update on commerce_quotes/i);
});

test("indexes retries, expiry, state, and audit ordering", () => {
  const sql = migration();
  for (const index of [
    "style_cases_state_idx",
    "commerce_quotes_case_retrieved_idx",
    "style_proofs_expires_idx",
    "payment_attempts_status_idx",
    "audit_events_case_occurred_idx",
  ]) {
    assert.match(sql, new RegExp(`create index if not exists ${index}\\b`, "i"));
  }
});

test("never persists raw wardrobe media", () => {
  const sql = migration();
  assert.doesNotMatch(sql, /\b(?:raw_(?:photo|media)|photo_bytes|media_bytes|bytea)\b/i);
});

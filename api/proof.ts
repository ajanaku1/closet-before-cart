import type { IncomingMessage, ServerResponse } from "node:http";
import { neon } from "@neondatabase/serverless";
import { createCaseStore } from "../src/adapters/case-store.js";
import { renderProofDocument } from "../src/presentation/proof-page.js";

export const runtime = "nodejs";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" }).end();
    return;
  }
  const proofId = new URL(request.url ?? "/", "https://cbc.invalid").searchParams.get("id");
  const connectionString = process.env.DATABASE_URL;
  if (!proofId || !connectionString) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Proof link is incomplete.");
    return;
  }
  const sql = neon(connectionString);
  const store = createCaseStore({
    baseUrl: "",
    query: (text, values) => sql.query(text, [...values]),
  });
  const model = await store.findProofModel(proofId);
  if (!model) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Proof was not found or has expired.");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
  }).end(renderProofDocument(model));
}

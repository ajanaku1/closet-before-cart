import type { IncomingMessage, ServerResponse } from "node:http";
import { neon } from "@neondatabase/serverless";
import { createCaseStore } from "../src/adapters/case-store.js";

export const runtime = "nodejs";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" }).end();
    return;
  }
  const caseId = new URL(request.url ?? "/", "https://cbc.invalid").searchParams.get("case");
  const connectionString = process.env.DATABASE_URL;
  if (!caseId || !connectionString) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Preview link is incomplete.");
    return;
  }
  const sql = neon(connectionString);
  const store = createCaseStore({
    baseUrl: "",
    query: (text, values) => sql.query(text, [...values]),
  });
  const preview = await store.findPreview(caseId);
  if (!preview) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Preview was not found or has expired.");
    return;
  }
  response.writeHead(200, {
    "content-type": preview.mimeType,
    "cache-control": "private, max-age=300",
    "content-length": String(preview.bytes.byteLength),
  }).end(preview.bytes);
}

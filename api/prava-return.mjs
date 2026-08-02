import { neon } from "@neondatabase/serverless";
import { Inngest } from "inngest";

export const runtime = "nodejs";

function html(response, status, message) {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>CBC sandbox approval</title><body><main><h1>${message}</h1><p>You can return to Messages. No merchant order was placed.</p></main></body></html>`);
}

export default async function handler(request, response) {
  if (request.method !== "GET") return html(response, 405, "Method not allowed");
  const caseId = new URL(request.url, "https://cbc.invalid").searchParams.get("case");
  const connectionString = process.env.DATABASE_URL;
  if (!caseId || !connectionString) return html(response, 400, "Approval link is incomplete");
  const sql = neon(connectionString);
  const rows = await sql.query(
    `select p.prava_reference as approval_id,
            c.result->>'chatId' as chat_id
       from payment_attempts p
       join style_cases c on c.id = p.case_id
      where p.case_id = $1
      order by p.created_at desc
      limit 1`,
    [caseId],
  );
  const row = rows[0];
  if (!row?.approval_id || !row?.chat_id) return html(response, 404, "Approval session was not found");
  const inngest = new Inngest({ id: "closet-before-cart" });
  await inngest.send({
    id: `${row.approval_id}-returned`,
    name: "cbc/prava.returned",
    data: { approvalId: row.approval_id, caseId, chatId: row.chat_id },
  });
  return html(response, 202, "Sandbox approval received");
}
